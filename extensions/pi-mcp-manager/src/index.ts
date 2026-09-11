import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { McpRuntime } from "./runtime.js";
import { McpClients } from "./client.js";
import { McpTools, registerSearchTool } from "./tools.js";
import { registerCommands } from "./commands.js";
import { OAUTH_CALLBACK_URL } from "./oauth-callback.js";
import { attentionStatus, serverState } from "./status.js";

export default function piMcpManager(pi: ExtensionAPI): void {
  let clients: McpClients | undefined;

  pi.on("session_start", async (_event, ctx) => {
    let runtime: McpRuntime;
    try {
      runtime = await McpRuntime.create(ctx);
    } catch (error) {
      ctx.ui.notify(`MCP configuration error: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    const updateStatus = (): void => {
      const states = Object.entries(runtime.resolved.servers).map(([id, server]) => serverState(id, server, runtime.auth, clients?.activity(id)));
      ctx.ui.setStatus("drakmyth.pi-mcp-manager", attentionStatus(states));
    };
    clients = new McpClients(
      runtime.auth,
      runtime.resolved.credentials,
      OAUTH_CALLBACK_URL,
      (serverId, url) => pi.events.emit("drakmyth:pi-mcp-manager:oauth-redirect", { serverId, url: url.toString() }),
      updateStatus,
    );
    const tools = new McpTools(pi, clients, () => runtime.resolved);
    registerSearchTool(pi, tools);
    tools.registerCatalogs();
    tools.applyInitialActivation();
    registerCommands(pi, runtime, clients);
    updateStatus();
  });

  pi.on("session_shutdown", async () => {
    await clients?.close();
    clients = undefined;
  });
}
