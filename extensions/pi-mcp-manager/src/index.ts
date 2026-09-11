import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { McpRuntime } from "./runtime.js";
import { McpClients } from "./client.js";
import { McpTools, registerSearchTool } from "./tools.js";
import { registerCommands } from "./commands.js";
import { OAUTH_CALLBACK_URL } from "./oauth-callback.js";

export default function piMcpManager(pi: ExtensionAPI): void {
  let clients: McpClients | undefined;

  pi.on("session_start", async (_event, ctx) => {
    const runtime = new McpRuntime();
    try {
      await runtime.load(ctx);
    } catch (error) {
      ctx.ui.notify(`MCP configuration error: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    clients = new McpClients(
      runtime.auth,
      runtime.resolved.credentials,
      OAUTH_CALLBACK_URL,
      (serverId, url) => pi.events.emit("drakmyth:pi-mcp-manager:oauth-redirect", { serverId, url: url.toString() }),
    );
    const tools = new McpTools(pi, clients, () => runtime.resolved);
    registerSearchTool(pi, tools);
    tools.registerCatalogs();
    tools.applyInitialActivation();
    registerCommands(pi, runtime, clients);
    const enabled = Object.values(runtime.resolved.servers).filter(server => server.enabled).length;
    if (enabled) ctx.ui.setStatus("drakmyth.pi-mcp-manager", `MCP ${enabled}`);
  });

  pi.on("session_shutdown", async () => {
    await clients?.close();
    clients = undefined;
  });
}
