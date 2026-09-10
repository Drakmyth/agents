import { readFile } from "node:fs/promises";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import { writeJsonAtomic } from "./config.js";

export interface ServerAuth {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
}
interface AuthFile { version: 1; servers: Record<string, ServerAuth> }

export class AuthStore {
  private data: AuthFile = { version: 1, servers: {} };
  constructor(private readonly path: string) {}
  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as AuthFile;
      if (parsed.version !== 1 || !parsed.servers) throw new Error("Unsupported MCP auth file");
      this.data = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  get(serverId: string): ServerAuth { return this.data.servers[serverId] ?? {}; }
  async patch(serverId: string, patch: Partial<ServerAuth>): Promise<void> {
    this.data.servers[serverId] = { ...this.get(serverId), ...patch };
    await writeJsonAtomic(this.path, this.data, true);
  }
  async clear(serverId: string, scope: "all" | "client" | "tokens" | "verifier" | "discovery" = "all"): Promise<void> {
    if (scope === "all") delete this.data.servers[serverId];
    else {
      const current = { ...this.get(serverId) };
      delete current[scope];
      this.data.servers[serverId] = current;
    }
    await writeJsonAtomic(this.path, this.data, true);
  }
}
