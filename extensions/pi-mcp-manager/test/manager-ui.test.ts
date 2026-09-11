import assert from "node:assert/strict";
import test from "node:test";
import type { ResolvedServer } from "../src/model.js";
import { serverActionItems, serverListItems } from "../src/manager-ui.js";

const server: ResolvedServer = {
  url: "https://example.test/mcp",
  name: "Example",
  enabled: true,
  toolMode: "on-demand",
  tools: {},
  headers: {},
  oauth: false,
  catalog: [{ name: "read", inputSchema: {} }],
};

test("server list leads with configured servers and exposes management entries", () => {
  const items = serverListItems({ example: server }, () => "ready");
  assert.deepEqual(items.map(item => item.value), ["server:example", "add", "credentials", "close"]);
  assert.equal(items[0]?.description, "ready - 1 tools - on-demand");
});

test("server details expose relevant selectable actions", () => {
  assert.deepEqual(serverActionItems(server).map(item => item.value), ["tools", "refresh", "edit", "duplicate", "toggle", "remove", "back"]);
  assert.deepEqual(serverActionItems({ ...server, oauth: true, enabled: false }).map(item => item.label), [
    "Browse tools",
    "Refresh catalog",
    "Edit connection",
    "Duplicate server",
    "Log in with OAuth",
    "Log out",
    "Enable server",
    "Remove configuration",
    "Back",
  ]);
});
