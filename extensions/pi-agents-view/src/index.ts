import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SupervisorClient } from "./client.ts";
import { agentViewPaths } from "./paths.ts";

export default function piAgentsView(pi: ExtensionAPI): void {
  pi.registerFlag("agents", {
    description: "Open the persistent multi-agent session view",
    type: "boolean",
    default: false,
  });

  const client = new SupervisorClient(agentViewPaths());
  const connect = async () => client.connectOrStart();

  pi.registerCommand("agents", {
    description: "Open Agent View",
    handler: async (_args, ctx) => {
      try {
        const health = await connect() as { pid: number };
        ctx.ui.notify(`Agent View supervisor is ready (pid ${health.pid}). The dashboard arrives in the UI milestone.`, "info");
      } catch (error) {
        ctx.ui.notify(`Agent View supervisor failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!pi.getFlag("agents")) return;
    try { await connect(); }
    catch (error) { ctx.ui.notify(`Agent View supervisor failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
  });
}
