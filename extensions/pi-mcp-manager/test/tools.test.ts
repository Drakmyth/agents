import assert from "node:assert/strict";
import test from "node:test";
import { McpTools } from "../src/tools.js";
import { resolveConfig } from "../src/config.js";
import { EMPTY_GLOBAL_CONFIG } from "../src/model.js";

test("activation preserves unmanaged tools and loads matching MCP tools", () => {
  let active = ["read"];
  const definitions: Array<{ name: string }> = [];
  const pi = {
    getAllTools: () => [{ name: "read" }],
    getActiveTools: () => active.slice(),
    setActiveTools: (names: string[]) => { active = names.slice(); },
    registerTool: (definition: { name: string }) => { definitions.push(definition); },
  };
  const config = resolveConfig({
    ...EMPTY_GLOBAL_CONFIG,
    servers: {
      api: {
        url: "https://example.test/mcp",
        toolMode: "on-demand",
        tools: { frequent: "automatic" },
        catalog: [
          { name: "frequent", description: "Read frequent records", inputSchema: { type: "object" } },
          { name: "issues", description: "Search project issues", inputSchema: { type: "object" } },
        ],
      },
    },
  });
  const tools = new McpTools(pi as never, {} as never, () => config);
  tools.registerCatalogs();
  tools.applyInitialActivation();
  assert.deepEqual(active, ["read", "mcp_api_frequent", "mcp_search_tools"]);
  assert.deepEqual(definitions.map(definition => definition.name), ["mcp_api_frequent", "mcp_api_issues"]);

  const result = tools.search("project issues", 5);
  assert.deepEqual(result.added, ["mcp_api_issues"]);
  assert.deepEqual(active, ["read", "mcp_api_frequent", "mcp_search_tools", "mcp_api_issues"]);
});
