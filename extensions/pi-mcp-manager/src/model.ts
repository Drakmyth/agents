export type ToolMode = "automatic" | "on-demand" | "disabled";
export type ActivationMode = Exclude<ToolMode, "disabled">;

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

export interface StoredServer {
  url: string;
  name?: string;
  enabled?: boolean;
  toolMode?: ActivationMode;
  tools?: Record<string, ToolMode>;
  headers?: Record<string, HeaderValue>;
  oauth?: boolean;
  catalog?: CachedTool[];
  catalogUpdatedAt?: string;
}

export type ProjectServerOverride = Partial<StoredServer>;

export interface ResolvedServer {
  url: string;
  name: string;
  enabled: boolean;
  toolMode: ActivationMode;
  tools: Record<string, ToolMode>;
  headers: Record<string, HeaderValue>;
  oauth: boolean;
  catalog: CachedTool[];
  catalogUpdatedAt?: string;
}

interface ConfigFile {
  format: "drakmyth.pi-mcp-manager";
  version: 1;
}

export interface GlobalConfig extends ConfigFile {
  credentials?: Record<string, CredentialProfile>;
  servers?: Record<string, StoredServer>;
}

export interface ProjectConfig extends ConfigFile {
  credentials?: never;
  servers?: Record<string, ProjectServerOverride>;
}

export interface ResolvedConfig extends ConfigFile {
  credentials: Record<string, CredentialProfile>;
  servers: Record<string, ResolvedServer>;
}

export const EMPTY_GLOBAL_CONFIG: GlobalConfig = {
  format: "drakmyth.pi-mcp-manager",
  version: 1,
  credentials: {},
  servers: {},
};

export const EMPTY_PROJECT_CONFIG: ProjectConfig = {
  format: "drakmyth.pi-mcp-manager",
  version: 1,
  servers: {},
};
