import type { AuthStore } from "./auth-store.js";
import type { ResolvedServer } from "./model.js";

export type ServerState = "ready" | "needs-refresh" | "login-needed" | "unavailable" | "disabled" | "checking";

export interface ServerRuntimeState {
  inFlight: number;
  lastRequestFailed: boolean;
}

export function serverState(serverId: string, server: ResolvedServer, auth: Pick<AuthStore, "get">, runtime?: ServerRuntimeState): ServerState {
  if (!server.enabled) return "disabled";
  if (runtime?.inFlight) return "checking";
  if (server.oauth && !auth.get(serverId).tokens?.access_token) return "login-needed";
  if (runtime?.lastRequestFailed) return "unavailable";
  if (!server.catalog.length) return "needs-refresh";
  return "ready";
}

export function stateLabel(state: ServerState): string {
  switch (state) {
    case "ready": return "ready";
    case "needs-refresh": return "needs refresh";
    case "login-needed": return "login needed";
    case "unavailable": return "unavailable";
    case "disabled": return "disabled";
    case "checking": return "checking";
  }
}

export function attentionStatus(states: Iterable<ServerState>): string | undefined {
  let login = 0;
  let unavailable = 0;
  let refresh = 0;
  for (const state of states) {
    if (state === "login-needed") login++;
    else if (state === "unavailable") unavailable++;
    else if (state === "needs-refresh") refresh++;
  }
  const parts: string[] = [];
  if (login) parts.push(`${login} need${login === 1 ? "s" : ""} login`);
  if (unavailable) parts.push(`${unavailable} unavailable`);
  if (refresh) parts.push(`${refresh} need${refresh === 1 ? "s" : ""} refresh`);
  return parts.length ? `MCP: ${parts.join("; ")}` : undefined;
}
