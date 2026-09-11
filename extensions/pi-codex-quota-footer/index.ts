import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { formatStatuses, formatTokens, thresholdColor } from "./format.js";
import { buildQuotaLines, getUsage, type UsageResponse } from "./quota.js";

const REFRESH_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

function buildPathLine(ctx: ExtensionContext, theme: Theme, footerData: ReadonlyFooterDataProvider, width: number): string {
  const branch = footerData.getGitBranch();
  return truncateToWidth(theme.fg("dim", `${ctx.cwd}${branch ? ` (${branch})` : ""}`), width);
}

function buildContextModelLine(ctx: ExtensionContext, theme: Theme, width: number): string {
  let input = 0;
  let output = 0;
  let cost = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cacheHit: number | undefined;

  const add = (usage: Usage | undefined): void => {
    if (!usage) return;
    input += usage.input;
    output += usage.output;
    cost += usage.cost.total;
    cacheRead += usage.cacheRead;
    cacheWrite += usage.cacheWrite;
  };

  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant") {
        const usage = entry.message.usage;
        const turnTokens = usage.input + usage.cacheRead + usage.cacheWrite;
        cacheHit = turnTokens > 0 ? usage.cacheRead / turnTokens * 100 : undefined;
        add(usage);
      } else if (entry.message.role === "toolResult") {
        add(entry.message.usage);
      }
    } else if (entry.type === "branch_summary" || entry.type === "compaction") {
      add(entry.usage);
    }
  }

  const context = ctx.getContextUsage();
  const percent = context?.percent?.toFixed(1) ?? "?";
  const stats = [`↑${formatTokens(input)}`, `↓${formatTokens(output)}`, `R${formatTokens(cacheRead)}`];
  if (cacheWrite > 0) stats.push(`W${formatTokens(cacheWrite)}`);
  if (cacheHit) stats.push(`CH${cacheHit.toFixed(1)}%`);
  stats.push(`$${cost.toFixed(3)}`);
  if (ctx.model && ctx.modelRegistry.isUsingOAuth(ctx.model)) stats.push("(sub)");
  stats.push(theme.fg(thresholdColor(context?.percent ?? 0), `${percent}%/${formatTokens(context?.contextWindow ?? 0)}`));

  const left = stats.join(" ");
  const thinking = ctx.thinkingLevel ?? "off";
  const right = `${ctx.model?.id ?? "no-model"} • ${thinking === "off" ? "thinking off" : thinking}`;
  const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
  return truncateToWidth(theme.fg("dim", left + padding + right), width);
}

export default function piCodexQuotaFooter(pi: ExtensionAPI): void {
  let usage: UsageResponse | undefined;
  let activeTui: TUI | undefined;
  let refreshPromise: Promise<void> | undefined;
  let refreshController: AbortController | undefined;
  let lastRefreshAt = 0;

  const refresh = (ctx: ExtensionContext, force = false): Promise<void> => {
    if (refreshPromise) return refreshPromise;
    if (!force && Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS) return Promise.resolve();

    lastRefreshAt = Date.now();
    const controller = new AbortController();
    refreshController = controller;
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    refreshPromise = getUsage(ctx, controller.signal)
      .then(result => { usage = result; })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        if (refreshController === controller) refreshController = undefined;
        refreshPromise = undefined;
        activeTui?.requestRender();
      });
    return refreshPromise;
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose() { unsubscribe(); activeTui = undefined; },
        invalidate() {},
        render(width) {
          const lines = [buildPathLine(ctx, theme, footerData, width), buildContextModelLine(ctx, theme, width)];
          const statusLine = formatStatuses(footerData.getExtensionStatuses());
          if (statusLine !== undefined) lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
          for (const line of buildQuotaLines(usage, theme)) lines.push(line);
          return lines;
        },
      };
    });
    void refresh(ctx, true);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    await refresh(ctx);
  });

  pi.on("session_shutdown", () => {
    refreshController?.abort();
    refreshController = undefined;
    refreshPromise = undefined;
    activeTui = undefined;
  });
}
