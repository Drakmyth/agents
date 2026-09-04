import { Usage } from "@earendil-works/pi-ai/dist";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, TUI } from "@earendil-works/pi-tui";
import { appendFileSync } from "node:fs";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function log(...values: unknown[]) {
  appendFileSync(
    "pi-extension.log",
    `${new Date().toISOString()} ${values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(" ")}\n`,
  );
}

interface UsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface UsageResponse {
  user_id: string;
  account_id: string;
  email: string;
  plan_type: string;
  rate_limit: {
    allowed: boolean;
    limit_reached: boolean;
    primary_window: UsageWindow | null;
    secondary_window: UsageWindow | null;
  };
  code_review_rate_limit: unknown | null;
  additional_rate_limits: unknown | null;
  credits: {
    has_credits: boolean;
    unlimited: boolean;
    overage_limit_reached: boolean;
    balance: number | string;
    approx_local_messages: number[];
    approx_cloud_messages: number[];
  };
  spend_control: {
    reached: boolean;
    individual_limit: unknown | null;
  };
  rate_limit_reached_type: unknown | null;
  promo: unknown | null;
  rate_limit_reset_credits: {
    available_count: number;
    applicable_available_count: number;
  };
}

function formatTokens(n: number): string {
  if (n < 1_000) return `${n}`;
  if (n < 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

const buildStockPathLine = (
  ctx: ExtensionContext,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
  width: number,
): string => {
  const branch = footerData.getGitBranch();
  const line = `${ctx.cwd}${branch ? ` (${branch})` : ""}`;
  return truncateToWidth(theme.fg("dim", line), width);
};

const getThresholdColor = (value: number): ThemeColor => {
  switch (true) {
    case value > 90:
      return "error";
    case value > 70:
      return "warning";
    default:
      return "dim";
  }
};

const buildStockContextModelLine = (ctx: ExtensionContext, theme: Theme, width: number): string => {
  //↑4.2M ↓528k R196M CH99.4% $134.867 (sub) ?/272k (auto)                                        gpt-5.6-sol • low
  //                                         12.4%/272k
  let input = 0,
    output = 0,
    cost = 0,
    cacheRead = 0,
    cacheWrite = 0;

  const add = (usage: Usage | undefined) => {
    if (usage) {
      input += usage.input;
      output += usage.output;
      cost += usage.cost.total;
      cacheRead += usage.cacheRead;
      cacheWrite += usage.cacheWrite;
    }
  };

  let cacheHit: number | undefined = 0;
  for (const e of ctx.sessionManager.getEntries()) {
    switch (e.type) {
      case "message":
        switch (e.message.role) {
          case "assistant":
            const usage = e.message.usage;
            const turnTokens = usage.input + usage.cacheRead + usage.cacheWrite;
            cacheHit = turnTokens > 0 ? (usage.cacheRead / turnTokens) * 100 : undefined;
          case "toolResult":
            add(e.message.usage);
        }
        break;
      case "branch_summary":
      case "compaction":
        add(e.usage);
    }
  }

  const context = ctx.getContextUsage();
  const pct = context?.percent?.toFixed(1) ?? "?";
  const pctColor = getThresholdColor(context?.percent ?? 0);
  const window = context?.contextWindow ?? 0;
  const thinking = ctx.thinkingLevel ?? "off";
  const subscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;

  const stats = [];
  stats.push(`↑${formatTokens(input)}`);
  stats.push(`↓${formatTokens(output)}`);
  stats.push(`R${formatTokens(cacheRead)}`);
  if (cacheWrite > 0) {
    stats.push(`W${formatTokens(cacheWrite)}`);
  }
  if (cacheHit) {
    stats.push(`CH${cacheHit.toFixed(1)}%`);
  }
  stats.push(`$${cost.toFixed(3)}`);
  if (subscription) {
    stats.push("(sub)");
  }

  stats.push(theme.fg(pctColor, `${pct}%/${formatTokens(window)}`));

  const left = stats.join(" ");
  const right = `${ctx.model?.id ?? "no-model"} • ${thinking === "off" ? "thinking off" : thinking}`;
  const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

  return truncateToWidth(theme.fg("dim", left + padding + right), width);
};

const buildStockFooterLines = (
  ctx: ExtensionContext,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
  width: number,
): string[] => {
  return [buildStockPathLine(ctx, theme, footerData, width), buildStockContextModelLine(ctx, theme, width)];
};

const extractAccountIdFromToken = async (token: string): Promise<string> => {
  const [, payload] = token.split(".");
  if (!payload) {
    return Promise.reject(new Error("Unexpected OpenAI Codex token format"));
  }

  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;

  if (!accountId) {
    return Promise.reject("Unable to extract Account Id from OAuth token");
  }
  return Promise.resolve(accountId);
};

const getUsage = async (ctx: ExtensionContext): Promise<UsageResponse> => {
  var token;

  const provider = ctx.model?.provider;
  if (provider) {
    token = await ctx.modelRegistry.getApiKeyForProvider(provider);
  }

  if (!token) {
    return Promise.reject(new Error("no OAuth token"));
  }

  var accountId = await extractAccountIdFromToken(token);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "ChatGPT-Account-Id": accountId,
  };

  try {
    const response = await fetch(USAGE_URL, { headers });
    if (!response.ok) {
      throw new Error(`Error retrieving usage: ${response.status}`);
    }
    const usage = (await response.json()) as UsageResponse;
    return Promise.resolve(usage);
  } catch (error) {
    return Promise.reject(error);
  }
};

function formatRemainingQuotaPercentage(used: number, theme: Theme): string {
  const remaining = Math.max(0, Math.min(100, 100 - used));
  const color = getThresholdColor(100 - remaining);
  return theme.fg(color, `${remaining.toFixed(0)}% remaining`);
}

const formatEpoch = (seconds?: number): string => {
  if (!seconds) {
    return "unknown";
  }

  const date = new Date(seconds * 1000);
  const offsetMinutes = -date.getTimezoneOffset();
  const shifted = new Date(date.getTime() + offsetMinutes * 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  const offset = `${sign}${hours}:${minutes}`;

  return shifted.toISOString().replace("Z", offset); // => '2015-01-26T06:40:36.181'
};

const buildQuotaFooterLines = (usage: UsageResponse | undefined, theme: Theme, width: number): string[] => {
  if (!usage) {
    return ["Quota usage: unavailable"];
  }

  const primary = usage.rate_limit.primary_window;
  const secondary = usage.rate_limit.secondary_window;

  const lines: string[] = [];
  if (primary?.used_percent !== undefined) {
    lines.push(
      `Quota${secondary ? " 1" : ""}: ${formatRemainingQuotaPercentage(primary.used_percent, theme)}, until ${formatEpoch(primary.reset_at)}`,
    );
  }

  if (secondary?.used_percent !== undefined) {
    lines.push(
      `Quota 2: ${formatRemainingQuotaPercentage(secondary.used_percent, theme)}, until ${formatEpoch(secondary.reset_at)}`,
    );
  }

  return lines.length ? lines : ["Quota usage: unavailable"];
};

export default function (pi: ExtensionAPI) {
  let usage: UsageResponse | undefined;
  let activeTui: TUI | undefined;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    usage = await getUsage(ctx);

    ctx.ui.setFooter((tui, theme, footerData) => {
      activeTui = tui;

      const unsubscribe = footerData.onBranchChange(() => {
        tui.requestRender();
      });

      return {
        dispose() {
          unsubscribe();
          activeTui = undefined;
        },

        invalidate() {},

        render(width) {
          return [...buildStockFooterLines(ctx, theme, footerData, width), ...buildQuotaFooterLines(usage, theme, width)];
        },
      };
    });
  });

  pi.on("message_end", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    usage = await getUsage(ctx);
    activeTui?.requestRender();
  });
}
