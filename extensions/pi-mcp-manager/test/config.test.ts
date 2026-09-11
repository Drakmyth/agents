import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    catalogUpdatedAt: undefined,
  });
});

test("runtime factory initializes storage and selects the most specific scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-mcp-runtime-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(directory, "global");
  try {
    const projectDir = join(directory, "project", ".pi");
    await mkdir(projectDir, { recursive: true });
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
    await writeFile(join(process.env.PI_CODING_AGENT_DIR, "mcp.json"), JSON.stringify({ ...EMPTY_GLOBAL_CONFIG, servers: { global: { url: "https://example.test/mcp" }, overridden: { url: "https://example.test/mcp" } } }));
    await writeFile(join(projectDir, "mcp.json"), JSON.stringify({ ...EMPTY_PROJECT_CONFIG, servers: { overridden: { enabled: false }, project: { url: "https://project.test/mcp" } } }));
    const runtime = await McpRuntime.create({ cwd: join(directory, "project"), isProjectTrusted: () => true } as never);
    assert.equal(runtime.storageScope("global"), "global");
    assert.equal(runtime.storageScope("overridden"), "project");
    assert.equal(runtime.storageScope("project"), "project");
    assert.throws(() => runtime.storageScope("missing"), /Unknown MCP server/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
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
