import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPaths, readGlobalConfig, readProjectConfig, resolveConfig, validateGlobalConfig, validateProjectConfig, writeJsonAtomic } from "./config.js";
import { AuthStore } from "./auth-store.js";
import type { GlobalConfig, ProjectConfig, ProjectServerOverride, ResolvedConfig, StoredServer, ToolMode } from "./model.js";
import { EMPTY_PROJECT_CONFIG } from "./model.js";

export type ConfigScope = "global" | "project";
type ConfigPaths = ReturnType<typeof configPaths>;

export class McpRuntime {
  private constructor(
    readonly paths: ConfigPaths,
    readonly auth: AuthStore,
    public global: GlobalConfig,
    public project: ProjectConfig,
    public resolved: ResolvedConfig,
  ) {}

  static async create(ctx: ExtensionContext): Promise<McpRuntime> {
    const paths = configPaths(ctx.cwd, CONFIG_DIR_NAME);
    const global = await readGlobalConfig(paths.global);
    const project = ctx.isProjectTrusted() ? await readProjectConfig(paths.project) : structuredClone(EMPTY_PROJECT_CONFIG);
    const resolved = resolveConfig(global, project);
    const auth = await AuthStore.open(paths.auth);
    return new McpRuntime(paths, auth, global, project, resolved);
  }

  async save(scope: ConfigScope): Promise<void> {
    const config = scope === "global" ? validateGlobalConfig(this.global) : validateProjectConfig(this.project);
    const resolved = resolveConfig(this.global, this.project);
    await writeJsonAtomic(scope === "global" ? this.paths.global : this.paths.project, config);
    this.resolved = resolved;
  }
  storageScope(serverId: string): ConfigScope {
    if (this.project.servers?.[serverId]) return "project";
    if (this.global.servers?.[serverId]) return "global";
    throw new Error(`Unknown MCP server: ${serverId}`);
  }
  async putGlobalServer(id: string, server: StoredServer): Promise<void> {
    this.global.servers ??= {};
    this.global.servers[id] = server;
    await this.save("global");
  }
  async putProjectOverride(id: string, override: ProjectServerOverride): Promise<void> {
    this.project.servers ??= {};
    this.project.servers[id] = override;
    await this.save("project");
  }
  async removeServer(scope: ConfigScope, id: string): Promise<void> {
    if (scope === "global") delete this.global.servers?.[id]; else delete this.project.servers?.[id];
    await this.save(scope);
  }
  async setEnabled(scope: ConfigScope, id: string, enabled: boolean): Promise<void> {
    if (scope === "global") {
      const current = this.global.servers?.[id] ?? this.resolved.servers[id];
      if (!current) throw new Error(`Unknown MCP server: ${id}`);
      this.global.servers ??= {};
      this.global.servers[id] = { ...current, enabled };
    } else {
      this.project.servers ??= {};
      this.project.servers[id] = { ...(this.project.servers[id] ?? {}), enabled };
    }
    await this.save(scope);
  }
  async setToolMode(scope: ConfigScope, serverId: string, toolName: string, mode: ToolMode): Promise<void> {
    if (scope === "global") {
      const servers = this.global.servers;
      const current = servers?.[serverId];
      if (!current) throw new Error(`Unknown global MCP server: ${serverId}`);
      servers[serverId] = { ...current, tools: { ...(current.tools ?? {}), [toolName]: mode } };
    } else {
      this.project.servers ??= {};
      const current = this.project.servers[serverId] ?? {};
      this.project.servers[serverId] = { ...current, tools: { ...(current.tools ?? {}), [toolName]: mode } };
    }
    await this.save(scope);
  }
}
