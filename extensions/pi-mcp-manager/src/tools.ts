import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { McpClients } from "./client.js";
import type { ResolvedConfig, CachedTool, ToolMode } from "./model.js";
import { toolName } from "./names.js";

interface RegisteredTool { piName: string; serverId: string; tool: CachedTool }

function effectiveMode(serverMode: "automatic" | "on-demand" | undefined, override: ToolMode | undefined): ToolMode {
  return override ?? serverMode ?? "on-demand";
}

function resultText(result: Awaited<ReturnType<McpClients["call"]>>): string {
  const content = "content" in result && Array.isArray(result.content) ? result.content as Array<Record<string, any>> : undefined;
  if (!content) return JSON.stringify(result);
  const parts = content.map(item => {
    if (item.type === "text") return String(item.text);
    if (item.type === "resource_link") return `${item.name}: ${item.uri}`;
    if (item.type === "resource") return "text" in item.resource ? item.resource.text : `[Binary resource: ${item.resource.uri}]`;
    return `[${item.type} content omitted]`;
  });
  if ("structuredContent" in result && result.structuredContent) parts.push(JSON.stringify(result.structuredContent, null, 2));
  return parts.join("\n");
}

export class McpTools {
  private readonly registered = new Map<string, RegisteredTool>();
  constructor(private readonly pi: ExtensionAPI, private readonly clients: McpClients, private readonly getConfig: () => ResolvedConfig) {}

  registerCatalogs(): void {
    const occupied = new Set(this.pi.getAllTools().map(tool => tool.name));
    for (const [serverId, server] of Object.entries(this.getConfig().servers)) {
      for (const tool of server.catalog ?? []) {
        const key = `${serverId}\0${tool.name}`;
        if (this.registered.has(key)) continue;
        const piName = toolName(serverId, tool.name, occupied);
        occupied.add(piName);
        this.registered.set(key, { piName, serverId, tool });
        this.pi.registerTool({
          name: piName,
          label: `${server.name ?? serverId}: ${tool.title ?? tool.name}`,
          description: `${tool.description ?? tool.name} (MCP server: ${server.name ?? serverId})`,
          parameters: tool.inputSchema as TSchema,
          execute: async (_id, params, signal) => {
            const current = this.getConfig().servers[serverId];
            if (!current?.enabled || effectiveMode(current.toolMode, current.tools?.[tool.name]) === "disabled") throw new Error(`MCP tool ${tool.name} is disabled`);
            const result = await this.clients.call(serverId, current, tool.name, params as Record<string, unknown>, signal);
            const text = resultText(result);
            if ("isError" in result && result.isError) throw new Error(text || `MCP tool ${tool.name} failed`);
            const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
            return {
              content: [{ type: "text" as const, text: truncated.content + (truncated.truncated ? "\n\n[MCP output truncated to pi tool limits.]" : "") }],
              details: { serverId, toolName: tool.name, structuredContent: "structuredContent" in result ? result.structuredContent : undefined },
            };
          },
        });
      }
    }
  }

  applyInitialActivation(): void {
    const managed = new Set([...this.registered.values()].map(tool => tool.piName));
    const active = this.pi.getActiveTools().filter(name => !managed.has(name));
    for (const registered of this.registered.values()) {
      const server = this.getConfig().servers[registered.serverId];
      if (server?.enabled && effectiveMode(server.toolMode, server.tools?.[registered.tool.name]) === "automatic") active.push(registered.piName);
    }
    this.pi.setActiveTools([...new Set([...active, "mcp_search_tools"])]);
  }

  search(query: string, limit: number): { matches: RegisteredTool[]; added: string[] } {
    const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const matches = [...this.registered.values()].map(item => {
      const server = this.getConfig().servers[item.serverId];
      const text = `${item.serverId} ${server?.name ?? ""} ${item.tool.name} ${item.tool.title ?? ""} ${item.tool.description ?? ""}`.toLowerCase();
      return { item, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
    }).filter(({ item, score }) => {
      const server = this.getConfig().servers[item.serverId];
      return score > 0 && !!server?.enabled && effectiveMode(server.toolMode, server.tools?.[item.tool.name]) === "on-demand";
    }).sort((a, b) => b.score - a.score || a.item.piName.localeCompare(b.item.piName)).slice(0, limit).map(value => value.item);
    const active = this.pi.getActiveTools();
    const added = matches.map(item => item.piName).filter(name => !active.includes(name));
    if (added.length) this.pi.setActiveTools([...new Set([...active, ...added])]);
    return { matches, added };
  }
}

export function registerSearchTool(pi: ExtensionAPI, tools: McpTools): void {
  pi.registerTool({
    name: "mcp_search_tools",
    label: "Search MCP Tools",
    description: "Search configured MCP servers for relevant on-demand tools and make matches available in this session",
    promptSnippet: "Search configured MCP tools when an external capability may help",
    promptGuidelines: ["Use mcp_search_tools when a task may benefit from a configured MCP server whose tools are not currently active."],
    parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
    async execute(_id, params) {
      const result = tools.search(params.query, params.limit ?? 5);
      const names = result.matches.map(item => item.piName);
      return { content: [{ type: "text", text: names.length ? `${result.added.length ? "Loaded" : "Found"} MCP tools: ${names.join(", ")}` : "No matching MCP tools found." }], details: { matches: names, added: result.added } };
    },
  });
}
