export type ToolMode = "automatic" | "on-demand" | "disabled";

export interface EnvSecretSource { env: string }
export interface CommandSecretSource { command: string[]; timeoutMs?: number }
export type SecretSource = EnvSecretSource | CommandSecretSource;

export interface HeaderLiteral { value: string }
export interface HeaderSecret {
  credential?: string;
  source?: SecretSource;
  template?: string;
}
export type HeaderValue = HeaderLiteral | HeaderSecret;

export interface CredentialProfile { source: SecretSource }

export interface CachedTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ServerConfig {
  name?: string;
  enabled?: boolean;
  url: string;
  toolMode?: Exclude<ToolMode, "disabled">;
  tools?: Record<string, ToolMode>;
  headers?: Record<string, HeaderValue>;
  oauth?: boolean;
  catalog?: CachedTool[];
}

export interface McpConfig {
  format: "drakmyth.pi-mcp-manager";
  version: 1;
  credentials?: Record<string, CredentialProfile>;
  servers?: Record<string, ServerConfig>;
}

export interface EffectiveConfig extends McpConfig {
  credentials: Record<string, CredentialProfile>;
  servers: Record<string, ServerConfig>;
}

export const EMPTY_CONFIG: McpConfig = {
  format: "drakmyth.pi-mcp-manager",
  version: 1,
  credentials: {},
  servers: {},
};
