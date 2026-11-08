import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { SupervisorClient } from "./client.ts";
import { DashboardModel, showDashboard } from "./dashboard.ts";
import { agentViewPaths } from "./paths.ts";
import { loadPreferences, savePreferences } from "./preferences.ts";

export default function piAgentsView(pi: ExtensionAPI): void {
  pi.registerFlag("agents", {
    description: "Open the persistent multi-agent session view",
    type: "boolean",
    default: false,
  });

  const paths = agentViewPaths();
  const client = new SupervisorClient(paths);
  const leaseId = randomUUID();
  let leased = false;
  let renewal: NodeJS.Timeout | undefined;
  let open = false;
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

  const openView = async (ctx: ExtensionContext, exitOnClose: boolean) => {
    if (open) return;
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Agent View requires interactive TUI mode", "error");
      return;
    }
    open = true;
    try {
      await connect();
      const preferences = await loadPreferences(paths.preferencesFile);
      const model = new DashboardModel(preferences.grouping);
      let dispatchRoot = ctx.cwd;
      while (true) {
        const action = await showDashboard(ctx, client, model, dispatchRoot);
        preferences.grouping = model.grouping;
        await savePreferences(paths.preferencesFile, preferences);
        if (action.type === "close") {
          if (exitOnClose) ctx.shutdown();
          return;
        }
        if (action.type === "root") {
          const root = await ctx.ui.input("Dispatch root directory", dispatchRoot);
          if (root?.trim()) dispatchRoot = root.trim();
          continue;
        }
        if (action.type === "filter") {
          const query = await ctx.ui.input("Filter agents", "task, root, activity, or state");
          if (query !== undefined) model.setFilter(query);
          continue;
        }
        if (action.type === "dispatch") {
          try {
            await client.request("launch", {
              payload: { root: dispatchRoot, prompt: action.prompt }, timeoutMs: 30_000, idempotencyKey: randomUUID(),
            });
          } catch (error) { ctx.ui.notify(`Could not launch agent: ${message(error)}`, "error"); }
          continue;
        }
        const selected = model.selected();
        if (!selected) continue;
        const method = action.type === "stop" ? "stop" : action.type === "resume" ? "resume" : "abort";
        try { await client.request(method, { payload: { id: selected.id }, timeoutMs: 30_000 }); }
        catch (error) { ctx.ui.notify(`Could not ${method} agent: ${message(error)}`, "error"); }
      }
    } catch (error) {
      ctx.ui.notify(`Agent View failed: ${message(error)}`, "error");
    } finally { open = false; }
  };

  pi.registerCommand("agents", {
    description: "Open Agent View",
    handler: async (_args, ctx) => openView(ctx, false),
  });

  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("agents")) await openView(ctx, true);
  });

  pi.on("session_shutdown", async () => {
    if (renewal) clearInterval(renewal);
    if (leased) await client.releaseLease(leaseId).catch(() => undefined);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
