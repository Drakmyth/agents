import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { EMPTY_CONFIG, type EffectiveConfig, type McpConfig, type ServerConfig } from "./model.js";

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

export function validateConfig(value: unknown, project = false): McpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP configuration must be an object");
  const input = value as Record<string, unknown>;
  if (input.format !== EMPTY_CONFIG.format || input.version !== 1) throw new Error("Unsupported MCP configuration format or version");
  if (project && input.credentials && Object.keys(input.credentials as object).length) {
    throw new Error("Project MCP configuration cannot define credential profiles");
  }
  const credentials = (input.credentials ?? {}) as Record<string, { source?: { env?: unknown; command?: unknown; timeoutMs?: unknown } }>;
  for (const [name, profile] of Object.entries(credentials)) {
    const source = profile?.source;
    const validEnv = typeof source?.env === "string" && source.env.length > 0;
    const validCommand = Array.isArray(source?.command) && source.command.length > 0 && source.command.every(value => typeof value === "string");
    if (!validEnv && !validCommand) throw new Error(`Invalid credential profile: ${name}`);
    if (source?.timeoutMs !== undefined && (typeof source.timeoutMs !== "number" || source.timeoutMs < 100 || source.timeoutMs > 120_000)) throw new Error(`Invalid credential timeout: ${name}`);
  }
  const servers = (input.servers ?? {}) as Record<string, ServerConfig>;
  for (const [id, server] of Object.entries(servers)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) throw new Error(`Invalid MCP server id: ${id}`);
    if (!server || typeof server !== "object") throw new Error(`Server ${id} must be an object`);
    if (!project && typeof server.url !== "string") throw new Error(`Server ${id} requires a URL`);
    if (server.url) {
      const url = new URL(server.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Server ${id} must use HTTP or HTTPS`);
    }
    if (server.toolMode && !["automatic", "on-demand"].includes(server.toolMode)) throw new Error(`Invalid tool mode for ${id}`);
  }
  return value as McpConfig;
}

export async function readConfig(path: string, project = false): Promise<McpConfig> {
  try {
    return validateConfig(JSON.parse(await readFile(path, "utf8")), project);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY_CONFIG);
    throw error;
  }
}

export async function writeJsonAtomic(path: string, value: unknown, secret = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: secret ? 0o600 : 0o644 });
  await rename(temporary, path);
}

export function mergeConfig(global: McpConfig, project?: McpConfig): EffectiveConfig {
  const servers: Record<string, ServerConfig> = structuredClone(global.servers ?? {});
  for (const [id, override] of Object.entries(project?.servers ?? {})) {
    const base = servers[id];
    servers[id] = base
      ? { ...base, ...structuredClone(override), tools: { ...(base.tools ?? {}), ...(override.tools ?? {}) }, headers: { ...(base.headers ?? {}), ...(override.headers ?? {}) } }
      : structuredClone(override);
  }
  for (const [id, server] of Object.entries(servers)) {
    if (!server.url) throw new Error(`Effective server ${id} requires a URL`);
  }
  return { ...EMPTY_CONFIG, credentials: structuredClone(global.credentials ?? {}), servers };
}
