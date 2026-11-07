import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { SupervisorClient } from "./client.ts";
import { agentViewPaths } from "./paths.ts";

export default function piAgentsView(pi: ExtensionAPI): void {
  pi.registerFlag("agents", {
    description: "Open the persistent multi-agent session view",
    type: "boolean",
    default: false,
  });

  const client = new SupervisorClient(agentViewPaths());
  const leaseId = randomUUID();
  let leased = false;
  let renewal: NodeJS.Timeout | undefined;
  const connect = async () => {
    const health = await client.connectOrStart();
    if (!leased) {
      await client.acquireLease(leaseId);
      leased = true;
      renewal = setInterval(() => void client.renewLease(leaseId).catch(() => undefined), 5_000);
      renewal.unref();
    }
    return health;
  };

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

  pi.on("session_shutdown", async () => {
    if (renewal) clearInterval(renewal);
    if (leased) await client.releaseLease(leaseId).catch(() => undefined);
  });
}
