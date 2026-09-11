import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

export interface UsageWindow {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

export interface UsageResponse {
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
  spend_control: { reached: boolean; individual_limit: unknown | null };
  rate_limit_reached_type: unknown | null;
  promo: unknown | null;
  rate_limit_reset_credits: { available_count: number; applicable_available_count: number };
}

interface CodexClaims {
  "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
}

export function extractAccountId(token: string): string {
  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) throw new Error("Unexpected OpenAI Codex token format");

  let claims: CodexClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CodexClaims;
  } catch {
    throw new Error("Unexpected OpenAI Codex token payload");
  }
  const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId) throw new Error("OpenAI Codex token has no account ID");
  return accountId;
}

export async function getUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageResponse> {
  const model = ctx.model;
  if (!model || !ctx.modelRegistry.isUsingOAuth(model)) throw new Error("OpenAI Codex OAuth is unavailable");
  const token = await ctx.modelRegistry.getApiKeyForProvider(model.provider);
  if (!token) throw new Error("OpenAI Codex OAuth token is unavailable");

  const response = await fetch(USAGE_URL, {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "ChatGPT-Account-Id": extractAccountId(token),
    },
  });
  if (!response.ok) throw new Error(`Error retrieving Codex usage: ${response.status}`);
  return await response.json() as UsageResponse;
}

function thresholdColor(value: number): "error" | "warning" | "dim" {
  if (value > 90) return "error";
  if (value > 70) return "warning";
  return "dim";
}

function formatRemaining(used: number, theme: Theme): string {
  const remaining = Math.max(0, Math.min(100, 100 - used));
  return theme.fg(thresholdColor(used), `${remaining.toFixed(0)}% remaining`);
}

export function formatEpoch(seconds?: number): string {
  if (!seconds) return "unknown";
  const date = new Date(seconds * 1000);
  const offsetMinutes = -date.getTimezoneOffset();
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return shifted.toISOString().replace("Z", `${sign}${hours}:${minutes}`);
}

export function buildQuotaLines(usage: UsageResponse | undefined, theme: Theme): string[] {
  if (!usage) return ["Quota usage: unavailable"];
  const primary = usage.rate_limit.primary_window;
  const secondary = usage.rate_limit.secondary_window;
  const lines: string[] = [];
  if (primary?.used_percent !== undefined) lines.push(`Quota${secondary ? " 1" : ""}: ${formatRemaining(primary.used_percent, theme)}, until ${formatEpoch(primary.reset_at)}`);
  if (secondary?.used_percent !== undefined) lines.push(`Quota 2: ${formatRemaining(secondary.used_percent, theme)}, until ${formatEpoch(secondary.reset_at)}`);
  return lines.length ? lines : ["Quota usage: unavailable"];
}
