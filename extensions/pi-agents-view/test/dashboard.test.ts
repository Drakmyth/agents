import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DashboardModel } from "../src/dashboard.ts";
import { loadPreferences, savePreferences } from "../src/preferences.ts";
import type { AgentRecord, Snapshot } from "../src/protocol.ts";

const agent = (id: string, root: string, state: AgentRecord["state"], createdAt: string): AgentRecord => ({
  id, root, task: `task ${id}`, state, createdAt, updatedAt: createdAt,
  workspace: { mode: "directory", selectedRoot: root, path: root, managed: false },
});
const snapshot = (...agents: AgentRecord[]): Snapshot => ({
  protocolVersion: 1, pid: 1, draining: false,
  registry: { version: 1, revision: 1, agents },
});

test("dashboard defaults to stable root grouping despite state changes", () => {
  const model = new DashboardModel();
  model.update(snapshot(
    agent("later", "C:/b", "running", "2026-01-02T00:00:00Z"),
    agent("first", "C:/a", "idle", "2026-01-01T00:00:00Z"),
    agent("second", "C:/a", "waiting", "2026-01-03T00:00:00Z"),
  ));
  assert.equal(model.grouping, "root");
  assert.deepEqual(model.groups().map((group) => [group.label, group.agents.map((value) => value.id)]), [
    ["C:/a", ["first", "second"]], ["C:/b", ["later"]],
  ]);
  model.update(snapshot(
    agent("later", "C:/b", "completed", "2026-01-02T00:00:00Z"),
    agent("first", "C:/a", "running", "2026-01-01T00:00:00Z"),
    agent("second", "C:/a", "completed", "2026-01-03T00:00:00Z"),
  ));
  assert.deepEqual(model.groups()[0]!.agents.map((value) => value.id), ["first", "second"]);
});

test("grouping changes explicitly and filtering retains matching agents", () => {
  const model = new DashboardModel("root");
  model.update(snapshot(agent("one", "C:/repo", "running", "2026-01-01T00:00:00Z"), agent("two", "C:/repo", "failed", "2026-01-02T00:00:00Z")));
  model.cycleGrouping();
  assert.equal(model.grouping, "state");
  assert.deepEqual(model.groups().map((group) => group.label), ["Failed", "Running"]);
  model.setFilter("task two");
  assert.deepEqual(model.groups().flatMap((group) => group.agents.map((value) => value.id)), ["two"]);
});

test("dashboard grouping preference persists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-agents-view-preferences-"));
  const path = join(directory, "preferences.json");
  try {
    assert.deepEqual(await loadPreferences(path), { grouping: "root" });
    await savePreferences(path, { grouping: "none" });
    assert.deepEqual(await loadPreferences(path), { grouping: "none" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
