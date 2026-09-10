import { createHash } from "node:crypto";

function segment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unnamed";
}

export function toolName(serverId: string, originalName: string, occupied = new Set<string>()): string {
  const base = `mcp_${segment(serverId)}_${segment(originalName)}`;
  if (!occupied.has(base)) return base;
  const suffix = createHash("sha256").update(`${serverId}\0${originalName}`).digest("hex").slice(0, 8);
  return `${base}_${suffix}`;
}
