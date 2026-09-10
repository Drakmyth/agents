import assert from "node:assert/strict";
import test from "node:test";
import { mergeConfig, validateConfig } from "../src/config.js";
import { EMPTY_CONFIG } from "../src/model.js";
import { toolName } from "../src/names.js";
import { redact } from "../src/credentials.js";

test("project server fields and nested overrides merge over global configuration", () => {
  const global = { ...EMPTY_CONFIG, credentials: { token: { source: { env: "TOKEN" } } }, servers: { api: { url: "https://global.test/mcp", tools: { read: "automatic" as const }, headers: { Accept: { value: "json" } } } } };
  const project = { ...EMPTY_CONFIG, servers: { api: { url: "https://project.test/mcp", enabled: false, tools: { write: "disabled" as const } } } };
  const merged = mergeConfig(global, project);
  assert.equal(merged.servers.api?.enabled, false);
  assert.equal(merged.servers.api?.url, "https://project.test/mcp");
  assert.deepEqual(merged.servers.api?.tools, { read: "automatic", write: "disabled" });
  assert.ok(merged.credentials.token);
});

test("project credential profiles are rejected", () => {
  assert.throws(() => validateConfig({ ...EMPTY_CONFIG, credentials: { bad: { source: { env: "X" } } } }, true), /cannot define/);
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
