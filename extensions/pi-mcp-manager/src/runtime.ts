import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPaths, mergeConfig, readGlobalConfig, readProjectConfig, validateGlobalConfig, validateProjectConfig, writeJsonAtomic } from "./config.js";
import { AuthStore } from "./auth-store.js";
import type { EffectiveConfig, GlobalConfig, ProjectConfig, ProjectServerOverride, StoredServer, ToolMode } from "./model.js";
import { EMPTY_GLOBAL_CONFIG, EMPTY_PROJECT_CONFIG } from "./model.js";

export type ConfigScope = "global" | "project";

export class McpRuntime {
  global: GlobalConfig = structuredClone(EMPTY_GLOBAL_CONFIG);
  project: ProjectConfig = structuredClone(EMPTY_PROJECT_CONFIG);
  effective: EffectiveConfig = mergeConfig(this.global);
  paths!: ReturnType<typeof configPaths>;
  auth!: AuthStore;

  async load(ctx: ExtensionContext): Promise<void> {
    this.paths = configPaths(ctx.cwd, CONFIG_DIR_NAME);
    this.global = await readGlobalConfig(this.paths.global);
    this.project = ctx.isProjectTrusted() ? await readProjectConfig(this.paths.project) : structuredClone(EMPTY_PROJECT_CONFIG);
    this.effective = mergeConfig(this.global, this.project);
    this.auth = new AuthStore(this.paths.auth);
    await this.auth.load();
  }

  async save(scope: ConfigScope): Promise<void> {
    const config = scope === "global" ? validateGlobalConfig(this.global) : validateProjectConfig(this.project);
    const effective = mergeConfig(this.global, this.project);
    await writeJsonAtomic(scope === "global" ? this.paths.global : this.paths.project, config);
    this.effective = effective;
  }
  origin(serverId: string): ConfigScope { return this.project.servers?.[serverId] ? "project" : "global"; }
  async putServer(scope: "global", id: string, server: StoredServer): Promise<void>;
  async putServer(scope: "project", id: string, server: ProjectServerOverride): Promise<void>;
  async putServer(scope: ConfigScope, id: string, server: StoredServer | ProjectServerOverride): Promise<void>;
  async putServer(scope: ConfigScope, id: string, server: StoredServer | ProjectServerOverride): Promise<void> {
    if (scope === "global") {
      this.global.servers ??= {};
      this.global.servers[id] = server as StoredServer;
    } else {
      this.project.servers ??= {};
      this.project.servers[id] = server;
    }
    await this.save(scope);
  }
  async removeServer(scope: ConfigScope, id: string): Promise<void> {
    if (scope === "global") delete this.global.servers?.[id]; else delete this.project.servers?.[id];
    await this.save(scope);
  }
  async setEnabled(scope: ConfigScope, id: string, enabled: boolean): Promise<void> {
    if (scope === "global") {
      const current = this.global.servers?.[id] ?? this.effective.servers[id];
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
      const current = this.global.servers?.[serverId];
      if (!current) throw new Error(`Unknown global MCP server: ${serverId}`);
      this.global.servers![serverId] = { ...current, tools: { ...(current.tools ?? {}), [toolName]: mode } };
    } else {
      this.project.servers ??= {};
      const current = this.project.servers[serverId] ?? {};
      this.project.servers[serverId] = { ...current, tools: { ...(current.tools ?? {}), [toolName]: mode } };
    }
    await this.save(scope);
  }
}
