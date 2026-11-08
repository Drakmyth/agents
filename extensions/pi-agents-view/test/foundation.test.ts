import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { SupervisorClient } from "../src/client.ts";
import { agentViewPaths } from "../src/paths.ts";
import { acquireLock, RegistryStore } from "../src/registry.ts";
import { SupervisorServer } from "../src/server.ts";
import { inspectManagedWorkspace, prepareWorkspace } from "../src/workspaces.ts";

const execFileAsync = promisify(execFile);

async function temporaryState(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-agents-view-"));
}

test("paths select a platform-native local endpoint", async () => {
  const root = await temporaryState();
  try {
    const paths = agentViewPaths(root);
    assert.equal(paths.stateDir, root);
    if (process.platform === "win32") assert.match(paths.endpoint, /^\\\\\.\\pipe\\pi-agents-view-/);
    else assert.equal(paths.endpoint, join(root, "supervisor.sock"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("registry creation is durable and locking excludes another supervisor", async () => {
  const root = await temporaryState();
  const paths = agentViewPaths(root);
  try {
    const store = new RegistryStore(paths);
    await store.open();
    assert.deepEqual(JSON.parse(await readFile(paths.registryFile, "utf8")), { version: 1, revision: 0, agents: [] });
    const lock = await acquireLock(paths.lockFile);
    await assert.rejects(acquireLock(paths.lockFile), /already running/);
    await lock.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("supervisor serves health and snapshots over bounded JSONL IPC", async () => {
  const root = await temporaryState();
  const paths = agentViewPaths(root);
  const server = new SupervisorServer(paths);
  try {
    await server.start();
    const client = new SupervisorClient(paths);
    const health = await client.request("health") as { protocolVersion: number; pid: number };
    assert.equal(health.protocolVersion, 1);
    assert.equal(health.pid, process.pid);
    await client.acquireLease("test-view");
    await client.renewLease("test-view");
    await client.releaseLease("test-view");
    const snapshot = await client.request("snapshot") as { registry: { agents: unknown[] } };
    assert.deepEqual(snapshot.registry.agents, []);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("supervisor hosts, settles, stops, and resumes persisted workers", async () => {
  const root = await temporaryState();
  const paths = agentViewPaths(root);
  const previousCommand = process.env.PI_AGENTS_VIEW_PI;
  const previousArgs = process.env.PI_AGENTS_VIEW_PI_ARGS;
  process.env.PI_AGENTS_VIEW_PI = process.execPath;
  process.env.PI_AGENTS_VIEW_PI_ARGS = JSON.stringify([fileURLToPath(new URL("./fake-worker.mjs", import.meta.url))]);
  const server = new SupervisorServer(paths);
  try {
    await server.start();
    const client = new SupervisorClient(paths);
    const launched = await client.request("launch", { payload: { root, prompt: "work" }, timeoutMs: 5_000 }) as { id: string };
    await new Promise((resolve) => setTimeout(resolve, 80));
    let snapshot = await client.request("snapshot") as { registry: { agents: Array<{ id: string; state: string; sessionFile?: string }> } };
    const completed = snapshot.registry.agents.find((agent) => agent.id === launched.id)!;
    assert.equal(completed.state, "completed");
    assert.match(completed.sessionFile!, /fake\.jsonl$/);
    await client.request("stop", { payload: { id: launched.id } });
    await client.request("resume", { payload: { id: launched.id } });
    snapshot = await client.request("snapshot") as typeof snapshot;
    assert.equal(snapshot.registry.agents[0]!.state, "idle");
  } finally {
    await server.close();
    if (previousCommand === undefined) delete process.env.PI_AGENTS_VIEW_PI; else process.env.PI_AGENTS_VIEW_PI = previousCommand;
    if (previousArgs === undefined) delete process.env.PI_AGENTS_VIEW_PI_ARGS; else process.env.PI_AGENTS_VIEW_PI_ARGS = previousArgs;
    await rm(root, { recursive: true, force: true });
  }
});

test("Git roots receive isolated worktrees while non-Git roots remain shared", async () => {
  const root = await temporaryState();
  const repository = join(root, "repository");
  const worktrees = join(root, "worktrees");
  const subdirectory = join(repository, "packages", "app");
  await mkdir(subdirectory, { recursive: true });
  await execFileAsync("git", ["init", repository]);
  await execFileAsync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await execFileAsync("git", ["-C", repository, "config", "user.name", "Test"]);
  await writeFile(join(repository, "README.md"), "test\n");
  await execFileAsync("git", ["-C", repository, "add", "."]);
  await execFileAsync("git", ["-C", repository, "commit", "-m", "initial"]);
  try {
    const isolated = await prepareWorkspace(subdirectory, "agent-1", worktrees);
    assert.equal(isolated.workspace.mode, "worktree");
    assert.equal(isolated.workspace.branch, "pi-agents-view/agent-1");
    assert.equal(isolated.root, join(isolated.workspace.path, "packages", "app"));
    assert.deepEqual(await inspectManagedWorkspace(isolated.workspace), { removable: true });
    const shared = await prepareWorkspace(root, "agent-2", worktrees);
    assert.equal(shared.workspace.mode, "directory");
    assert.match(shared.workspace.warning!, /may conflict/);
  } finally {
    await execFileAsync("git", ["-C", repository, "worktree", "remove", "--force", join(worktrees, "agent-1")]).catch(() => undefined);
    await execFileAsync("git", ["-C", repository, "branch", "-D", "pi-agents-view/agent-1"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
