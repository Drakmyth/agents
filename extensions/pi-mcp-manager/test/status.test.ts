import assert from "node:assert/strict";
import test from "node:test";
import type { AuthStore, ServerAuth } from "../src/auth-store.js";
import type { ResolvedServer } from "../src/model.js";
import { attentionStatus, serverState, type ServerActivity } from "../src/status.js";

const base: ResolvedServer = {
  url: "https://example.test/mcp",
  name: "test",
  enabled: true,
  toolMode: "on-demand",
  tools: {},
  headers: {},
  oauth: false,
  catalog: [{ name: "read", inputSchema: {} }],
};

function auth(hasToken = false): Pick<AuthStore, "get"> {
  return { get: (): ServerAuth => hasToken ? { tokens: { access_token: "token", token_type: "bearer" } } : {} };
}

function state(server: Partial<ResolvedServer> = {}, activity?: ServerActivity, hasToken = false) {
  return serverState("test", { ...base, ...server }, auth(hasToken), activity);
}

test("serverState describes availability rather than transport lifetime", () => {
  assert.equal(state(), "ready");
  assert.equal(state({ enabled: false }, { checking: true, failed: false }), "disabled");
  assert.equal(state({}, { checking: true, failed: false }), "checking");
  assert.equal(state({}, { checking: false, failed: true }), "unavailable");
  assert.equal(state({ oauth: true }), "login-needed");
  assert.equal(state({ oauth: true }, undefined, true), "ready");
  assert.equal(state({ catalog: [] }), "needs-refresh");
});

test("attentionStatus includes only actionable states", () => {
  assert.equal(attentionStatus(["ready", "disabled", "checking"]), undefined);
  assert.equal(attentionStatus(["login-needed", "unavailable", "needs-refresh", "needs-refresh"]), "MCP: 1 needs login; 1 unavailable; 2 need refresh");
});
