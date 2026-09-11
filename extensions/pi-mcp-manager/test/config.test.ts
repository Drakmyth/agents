import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig, validateProjectConfig } from "../src/config.js";
import { EMPTY_GLOBAL_CONFIG, EMPTY_PROJECT_CONFIG } from "../src/model.js";
import { toolName } from "../src/names.js";
import { redact } from "../src/credentials.js";
import { McpRuntime } from "../src/runtime.js";

test("project server fields and nested overrides merge over global configuration", () => {
  const global = { ...EMPTY_GLOBAL_CONFIG, credentials: { token: { source: { env: "TOKEN" } } }, servers: { api: { url: "https://global.test/mcp", tools: { read: "automatic" as const }, headers: { Accept: { value: "json" } } } } };
  const project = { ...EMPTY_PROJECT_CONFIG, servers: { api: { enabled: false, tools: { write: "disabled" as const } } } };
  const resolved = resolveConfig(global, project);
  assert.equal(resolved.servers.api?.enabled, false);
  assert.equal(resolved.servers.api?.url, "https://global.test/mcp");
  assert.deepEqual(resolved.servers.api?.tools, { read: "automatic", write: "disabled" });
  assert.ok(resolved.credentials.token);
});

test("resolved servers contain runtime defaults", () => {
  const resolved = resolveConfig({ ...EMPTY_GLOBAL_CONFIG, servers: { api: { url: "https://example.test/mcp" } } });
  assert.deepEqual(resolved.servers.api, {
    url: "https://example.test/mcp",
    name: "api",
    enabled: true,
    toolMode: "on-demand",
    tools: {},
    headers: {},
    oauth: false,
    catalog: [],
  });
});

test("storage scope selects the most specific stored entry", () => {
  const runtime = new McpRuntime();
  runtime.global.servers = { global: { url: "https://example.test/mcp" }, overridden: { url: "https://example.test/mcp" } };
  runtime.project.servers = { overridden: { enabled: false }, project: { url: "https://project.test/mcp" } };
  assert.equal(runtime.storageScope("global"), "global");
  assert.equal(runtime.storageScope("overridden"), "project");
  assert.equal(runtime.storageScope("project"), "project");
  assert.throws(() => runtime.storageScope("missing"), /Unknown MCP server/);
});

test("project credential profiles are rejected", () => {
  assert.throws(() => validateProjectConfig({ ...EMPTY_PROJECT_CONFIG, credentials: { bad: { source: { env: "X" } } } }), /cannot define/);
});

test("tool names are namespaced and collisions receive stable suffixes", () => {
  assert.equal(toolName("GitHub", "get-issue"), "mcp_github_get_issue");
  const occupied = new Set(["mcp_github_get_issue"]);
  assert.match(toolName("GitHub", "get-issue", occupied), /^mcp_github_get_issue_[a-f0-9]{8}$/);
  assert.equal(toolName("GitHub", "get-issue", occupied), toolName("GitHub", "get-issue", occupied));
});

test("redaction handles multiple and overlapping secrets", () => {
  assert.equal(redact("Bearer abc and abc123", ["abc", "abc123"]), "Bearer [REDACTED] and [REDACTED]");
});
