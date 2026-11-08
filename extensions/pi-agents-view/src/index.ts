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
      const connection = connect();
      const preferences = await loadPreferences(paths.preferencesFile);
      const model = new DashboardModel(preferences.grouping);
      while (true) {
        const action = await showDashboard(ctx, client, model, ctx.cwd, connection);
        preferences.grouping = model.grouping;
        await savePreferences(paths.preferencesFile, preferences);
        if (action.type === "error") throw new Error(action.message);
        if (action.type === "close") {
          if (exitOnClose) {
            blankForeground(ctx);
            ctx.shutdown();
          }
          return;
        }
        if (action.type === "filter") {
          const query = await ctx.ui.input("Filter agents", "task, root, activity, or state");
          if (query !== undefined) model.setFilter(query);
          continue;
        }
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

function blankForeground(ctx: ExtensionContext): void {
  const empty = () => ({ render: () => [], invalidate: () => undefined });
  ctx.ui.setHeader(empty);
  ctx.ui.setFooter(empty);
  ctx.ui.setEditorComponent(() => ({
    ...empty(),
    getText: () => "",
    setText: () => undefined,
    handleInput: () => undefined,
  }));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
