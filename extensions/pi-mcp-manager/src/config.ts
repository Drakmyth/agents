import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  EMPTY_GLOBAL_CONFIG,
  EMPTY_PROJECT_CONFIG,
  type ResolvedConfig,
  type GlobalConfig,
  type ProjectConfig,
  type ProjectServerOverride,
  type ResolvedServer,
  type StoredServer,
} from "./model.js";

export function globalConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function configPaths(cwd: string, projectConfigDirName: string): { global: string; project: string; auth: string } {
  return {
    global: join(globalConfigDir(), "mcp.json"),
    project: join(cwd, projectConfigDirName, "mcp.json"),
    auth: join(globalConfigDir(), "mcp-auth.json"),
  };
}

function validateEnvelope(input: Record<string, unknown>): void {
  if (input.format !== EMPTY_GLOBAL_CONFIG.format || input.version !== 1) throw new Error("Unsupported MCP configuration format or version");
}

function validateCredentials(input: Record<string, unknown>): void {
  const credentials = (input.credentials ?? {}) as Record<string, { source?: { env?: unknown; command?: unknown; timeoutMs?: unknown } }>;
  for (const [name, profile] of Object.entries(credentials)) {
    const source = profile?.source;
    const validEnv = typeof source?.env === "string" && source.env.length > 0;
    const validCommand = Array.isArray(source?.command) && source.command.length > 0 && source.command.every(value => typeof value === "string");
    if (!validEnv && !validCommand) throw new Error(`Invalid credential profile: ${name}`);
    if (source?.timeoutMs !== undefined && (typeof source.timeoutMs !== "number" || source.timeoutMs < 100 || source.timeoutMs > 120_000)) throw new Error(`Invalid credential timeout: ${name}`);
  }
}

function validateServers(servers: Record<string, ProjectServerOverride>, requireUrl: boolean): void {
  for (const [id, server] of Object.entries(servers)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`Invalid MCP server id: ${id}`);
    if (!server || typeof server !== "object") throw new Error(`Server ${id} must be an object`);
    if (requireUrl && typeof server.url !== "string") throw new Error(`Server ${id} requires a URL`);
    if (server.url) {
      const url = new URL(server.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Server ${id} must use HTTP or HTTPS`);
    }
    if (server.toolMode && !["automatic", "on-demand"].includes(server.toolMode)) throw new Error(`Invalid tool mode for ${id}`);
    if (server.catalogUpdatedAt !== undefined && (typeof server.catalogUpdatedAt !== "string" || Number.isNaN(Date.parse(server.catalogUpdatedAt)))) throw new Error(`Invalid catalog refresh time for ${id}`);
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP configuration must be an object");
  return value as Record<string, unknown>;
}

export function validateGlobalConfig(value: unknown): GlobalConfig {
  const input = parseObject(value);
  validateEnvelope(input);
  validateCredentials(input);
  validateServers((input.servers ?? {}) as Record<string, StoredServer>, true);
  return value as GlobalConfig;
}

export function validateProjectConfig(value: unknown): ProjectConfig {
  const input = parseObject(value);
  validateEnvelope(input);
  if (input.credentials && Object.keys(input.credentials as object).length) throw new Error("Project MCP configuration cannot define credential profiles");
  validateServers((input.servers ?? {}) as Record<string, ProjectServerOverride>, false);
  return value as ProjectConfig;
}

async function readJson(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function readGlobalConfig(path: string): Promise<GlobalConfig> {
  const value = await readJson(path);
  return value === undefined ? structuredClone(EMPTY_GLOBAL_CONFIG) : validateGlobalConfig(value);
}

export async function readProjectConfig(path: string): Promise<ProjectConfig> {
  const value = await readJson(path);
  return value === undefined ? structuredClone(EMPTY_PROJECT_CONFIG) : validateProjectConfig(value);
}

export async function writeJsonAtomic(path: string, value: unknown, secret = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: secret ? 0o600 : 0o644 });
  await rename(temporary, path);
}

function resolveServer(id: string, stored: StoredServer, override?: ProjectServerOverride): ResolvedServer {
  const merged = { ...stored, ...structuredClone(override), tools: { ...(stored.tools ?? {}), ...(override?.tools ?? {}) }, headers: { ...(stored.headers ?? {}), ...(override?.headers ?? {}) } };
  return {
    url: merged.url,
    name: merged.name ?? id,
    enabled: merged.enabled ?? true,
    toolMode: merged.toolMode ?? "on-demand",
    tools: merged.tools,
    headers: merged.headers,
    oauth: merged.oauth ?? false,
    catalog: merged.catalog ?? [],
    catalogUpdatedAt: merged.catalogUpdatedAt,
  };
}

export function resolveConfig(global: GlobalConfig, project: ProjectConfig = EMPTY_PROJECT_CONFIG): ResolvedConfig {
  const servers: Record<string, ResolvedServer> = {};
  for (const [id, stored] of Object.entries(global.servers ?? {})) servers[id] = resolveServer(id, stored, project.servers?.[id]);
  for (const [id, override] of Object.entries(project.servers ?? {})) {
    if (servers[id]) continue;
    if (!override.url) throw new Error(`Project server ${id} requires a URL because it does not override a global server`);
    servers[id] = resolveServer(id, { ...override, url: override.url });
  }
  return { ...EMPTY_GLOBAL_CONFIG, credentials: structuredClone(global.credentials ?? {}), servers };
}
