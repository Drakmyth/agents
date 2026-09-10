import { randomBytes } from "node:crypto";
import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { AuthStore } from "./auth-store.js";

export class PersistentOAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata;
  private expectedState = randomBytes(24).toString("base64url");

  constructor(
    private readonly serverId: string,
    private readonly store: AuthStore,
    readonly redirectUrl: URL,
    private readonly onRedirect: (url: URL) => void | Promise<void>,
  ) {
    this.clientMetadata = {
      client_name: "pi MCP Manager",
      redirect_uris: [redirectUrl.toString()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state(): string { return this.expectedState; }
  verifyState(value: string | null): boolean { return value === this.expectedState; }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.store.get(this.serverId).client; }
  async saveClientInformation(value: OAuthClientInformationMixed): Promise<void> { await this.store.patch(this.serverId, { client: value }); }
  tokens(): OAuthTokens | undefined { return this.store.get(this.serverId).tokens; }
  async saveTokens(value: OAuthTokens): Promise<void> { await this.store.patch(this.serverId, { tokens: value }); }
  redirectToAuthorization(url: URL): void | Promise<void> { return this.onRedirect(url); }
  async saveCodeVerifier(value: string): Promise<void> { await this.store.patch(this.serverId, { verifier: value }); }
  codeVerifier(): string {
    const value = this.store.get(this.serverId).verifier;
    if (!value) throw new Error("No OAuth PKCE verifier is available");
    return value;
  }
  async saveDiscoveryState(value: OAuthDiscoveryState): Promise<void> { await this.store.patch(this.serverId, { discovery: value }); }
  discoveryState(): OAuthDiscoveryState | undefined { return this.store.get(this.serverId).discovery; }
  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> { await this.store.clear(this.serverId, scope); }
}
