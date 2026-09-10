import { CONFIG_DIR_NAME, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPaths, mergeConfig, readConfig, writeJsonAtomic } from "./config.js";
import { AuthStore } from "./auth-store.js";
import type { EffectiveConfig, McpConfig, ServerConfig, ToolMode } from "./model.js";
import { EMPTY_CONFIG } from "./model.js";

export type ConfigScope = "global" | "project";

export class McpRuntime {
  global: McpConfig = structuredClone(EMPTY_CONFIG);
  project: McpConfig = structuredClone(EMPTY_CONFIG);
  effective: EffectiveConfig = mergeConfig(this.global);
  paths!: ReturnType<typeof configPaths>;
  auth!: AuthStore;

  async load(ctx: ExtensionContext): Promise<void> {
    this.paths = configPaths(ctx.cwd, CONFIG_DIR_NAME);
    this.global = await readConfig(this.paths.global);
    this.project = ctx.isProjectTrusted() ? await readConfig(this.paths.project, true) : structuredClone(EMPTY_CONFIG);
    this.effective = mergeConfig(this.global, this.project);
    this.auth = new AuthStore(this.paths.auth);
    await this.auth.load();
  }

  private config(scope: ConfigScope): McpConfig { return scope === "global" ? this.global : this.project; }
  async save(scope: ConfigScope): Promise<void> {
    const config = this.config(scope);
    await writeJsonAtomic(scope === "global" ? this.paths.global : this.paths.project, config);
    this.effective = mergeConfig(this.global, this.project);
  }
  origin(serverId: string): ConfigScope { return this.project.servers?.[serverId] ? "project" : "global"; }
  async putServer(scope: ConfigScope, id: string, server: ServerConfig): Promise<void> {
    const config = this.config(scope);
    config.servers ??= {};
    config.servers[id] = server;
    await this.save(scope);
  }
  async removeServer(scope: ConfigScope, id: string): Promise<void> {
    delete this.config(scope).servers?.[id];
    await this.save(scope);
  }
  async setEnabled(scope: ConfigScope, id: string, enabled: boolean): Promise<void> {
    const config = this.config(scope);
    config.servers ??= {};
    config.servers[id] = { ...(config.servers[id] ?? (scope === "project" ? {} : this.effective.servers[id])), enabled };
    await this.save(scope);
  }
  async setToolMode(scope: ConfigScope, serverId: string, toolName: string, mode: ToolMode): Promise<void> {
    const config = this.config(scope);
    config.servers ??= {};
    const current = config.servers[serverId] ?? (scope === "project" ? {} : this.effective.servers[serverId]);
    config.servers[serverId] = { ...current, tools: { ...(current?.tools ?? {}), [toolName]: mode } };
    await this.save(scope);
  }
}
