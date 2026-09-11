import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export function formatTokens(value: number): string {
  if (value < 1_000) return `${value}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

export function thresholdColor(value: number): ThemeColor {
  if (value > 90) return "error";
  if (value > 70) return "warning";
  return "dim";
}

// TODO: Revisit combining all extension statuses onto one line; a custom footer can avoid this default-footer limitation.
export function formatStatuses(statuses: ReadonlyMap<string, string>): string | undefined {
  if (statuses.size === 0) return undefined;
  return Array.from(statuses)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
    .join(" ");
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
