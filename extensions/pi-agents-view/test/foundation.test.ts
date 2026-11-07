import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SupervisorClient } from "../src/client.ts";
import { agentViewPaths } from "../src/paths.ts";
import { acquireLock, RegistryStore } from "../src/registry.ts";
import { SupervisorServer } from "../src/server.ts";

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
    const snapshot = await client.request("snapshot") as { registry: { agents: unknown[] } };
    assert.deepEqual(snapshot.registry.agents, []);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
