import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { McpClients } from "./client.js";
import { McpRuntime, type ConfigScope } from "./runtime.js";
import { listenForOAuthCallback } from "./oauth-callback.js";
import type { ServerConfig, ToolMode } from "./model.js";

async function openBrowser(pi: ExtensionAPI, url: URL): Promise<void> {
  const command = process.platform === "win32" ? ["cmd", ["/c", "start", "", url.toString()]] as const
    : process.platform === "darwin" ? ["open", [url.toString()]] as const
    : ["xdg-open", [url.toString()]] as const;
  await pi.exec(command[0], [...command[1]], { timeout: 5_000 }).catch(() => undefined);
}

async function chooseScope(ctx: ExtensionCommandContext): Promise<ConfigScope | undefined> {
  const values = ctx.isProjectTrusted() ? ["global", "project"] : ["global"];
  return await ctx.ui.select("Configuration scope", values) as ConfigScope | undefined;
}

async function addServer(ctx: ExtensionCommandContext, runtime: McpRuntime): Promise<boolean> {
  const scope = await chooseScope(ctx);
  if (!scope) return false;
  const id = (await ctx.ui.input("Server ID", "github"))?.trim();
  if (!id) return false;
  const url = (await ctx.ui.input("Streamable HTTP endpoint", "https://example.com/mcp"))?.trim();
  if (!url) return false;
  const name = (await ctx.ui.input("Display name", id))?.trim() || id;
  const toolMode = await ctx.ui.select("Default tool activation", ["on-demand", "automatic"]) as "on-demand" | "automatic" | undefined;
  if (!toolMode) return false;
  const profileNames = Object.keys(runtime.effective.credentials);
  const authOptions = ["OAuth", "Bearer token from environment", ...(profileNames.length ? ["Bearer token from credential profile"] : []), "None"];
  const auth = await ctx.ui.select("Authentication", authOptions);
  if (!auth) return false;
  const server: ServerConfig = { name, url, enabled: true, toolMode, oauth: auth === "OAuth" };
  if (auth === "Bearer token from environment") {
    const variable = (await ctx.ui.input("Environment variable", "MCP_TOKEN"))?.trim();
    if (!variable) return false;
    server.headers = { Authorization: { source: { env: variable }, template: "Bearer {secret}" } };
  } else if (auth === "Bearer token from credential profile") {
    const credential = await ctx.ui.select("Credential profile", profileNames);
    if (!credential) return false;
    server.headers = { Authorization: { credential, template: "Bearer {secret}" } };
  }
  await runtime.putServer(scope, id, server);
  ctx.ui.notify(`Added MCP server ${id}`, "info");
  return true;
}

async function refreshServer(id: string, ctx: ExtensionCommandContext, runtime: McpRuntime, clients: McpClients): Promise<void> {
  const server = runtime.effective.servers[id];
  if (!server) throw new Error(`Unknown MCP server: ${id}`);
  const catalog = await clients.refresh(id, server);
  const scope = runtime.origin(id);
  const source = scope === "global" ? runtime.global.servers?.[id] : runtime.project.servers?.[id];
  await runtime.putServer(scope, id, { ...source, catalog });
  ctx.ui.notify(`Refreshed ${catalog.length} tools from ${id}. Reloading MCP tools.`, "info");
  await ctx.reload();
}

async function loginServer(pi: ExtensionAPI, id: string, ctx: ExtensionCommandContext, runtime: McpRuntime, clients: McpClients): Promise<void> {
  const server = runtime.effective.servers[id];
  if (!server) throw new Error(`Unknown MCP server: ${id}`);
  if (!server.oauth) throw new Error(`OAuth is not enabled for ${id}`);
  const callback = await listenForOAuthCallback();
  try {
    ctx.ui.notify("Your browser will open for MCP authorization.", "info");
    await clients.login(id, server, callback.result);
    ctx.ui.notify(`Authorized ${id}`, "info");
  } finally { await callback.close(); }
}

async function configureTools(id: string, ctx: ExtensionCommandContext, runtime: McpRuntime): Promise<boolean> {
  const server = runtime.effective.servers[id];
  if (!server?.catalog?.length) { ctx.ui.notify("Refresh this server's tool catalog first.", "warning"); return false; }
  const tool = await ctx.ui.select("Tool", server.catalog.map(item => item.name));
  if (!tool) return false;
  const mode = await ctx.ui.select("Activation", ["automatic", "on-demand", "disabled"]) as ToolMode | undefined;
  if (!mode) return false;
  await runtime.setToolMode(runtime.origin(id), id, tool, mode);
  return true;
}

async function addCredential(ctx: ExtensionCommandContext, runtime: McpRuntime): Promise<boolean> {
  const name = (await ctx.ui.input("Global credential profile name", "github-token"))?.trim();
  if (!name) return false;
  const kind = await ctx.ui.select("Credential source", ["Environment variable", "Command"]);
  if (!kind) return false;
  runtime.global.credentials ??= {};
  if (kind === "Environment variable") {
    const variable = (await ctx.ui.input("Environment variable", "MCP_TOKEN"))?.trim();
    if (!variable) return false;
    runtime.global.credentials[name] = { source: { env: variable } };
  } else {
    const input = await ctx.ui.editor("Executable and arguments as a JSON array", '["op", "read", "op://Personal/MCP/token"]');
    if (!input) return false;
    const command = JSON.parse(input) as unknown;
    if (!Array.isArray(command) || !command.length || !command.every(value => typeof value === "string")) throw new Error("Credential command must be a nonempty JSON string array");
    const display = command.map(value => JSON.stringify(value)).join(" ");
    if (!await ctx.ui.confirm("Allow credential command?", `The extension will execute without a shell:\n${display}`)) return false;
    runtime.global.credentials[name] = { source: { command } };
  }
  await runtime.save("global");
  ctx.ui.notify(`Saved global credential profile ${name}`, "info");
  return true;
}

async function interactive(pi: ExtensionAPI, ctx: ExtensionCommandContext, runtime: McpRuntime, clients: McpClients): Promise<void> {
  while (true) {
    const servers = Object.entries(runtime.effective.servers);
    const action = await ctx.ui.select("MCP Manager", ["Add server", "Manage server", "Add credential profile", "Close"]);
    if (!action || action === "Close") return;
    if (action === "Add server") { if (await addServer(ctx, runtime)) { await ctx.reload(); return; } continue; }
    if (action === "Add credential profile") { if (await addCredential(ctx, runtime)) { await ctx.reload(); return; } continue; }
    if (!servers.length) { ctx.ui.notify("No MCP servers configured.", "info"); continue; }
    const id = await ctx.ui.select("Server", servers.map(([key, server]) => `${key} — ${server.enabled === false ? "disabled" : clients.isConnected(key) ? "connected" : "disconnected"}`));
    if (!id) continue;
    const serverId = id.split(" — ")[0]!;
    const operation = await ctx.ui.select(serverId, ["Refresh tools", "Configure tool", "Login with OAuth", "Logout", runtime.effective.servers[serverId]?.enabled === false ? "Enable" : "Disable", "Disconnect", "Remove override/configuration", "Back"]);
    if (!operation || operation === "Back") continue;
    if (operation === "Refresh tools") { await refreshServer(serverId, ctx, runtime, clients); return; }
    if (operation === "Configure tool") { if (await configureTools(serverId, ctx, runtime)) { await ctx.reload(); return; } }
    else if (operation === "Login with OAuth") await loginServer(pi, serverId, ctx, runtime, clients);
    else if (operation === "Logout") { await runtime.auth.clear(serverId); await clients.disconnect(serverId); ctx.ui.notify(`Logged out of ${serverId}`, "info"); }
    else if (operation === "Disconnect") await clients.disconnect(serverId);
    else if (operation === "Enable" || operation === "Disable") { await runtime.setEnabled(runtime.origin(serverId), serverId, operation === "Enable"); await ctx.reload(); return; }
    else if (operation === "Remove override/configuration") {
      const scope = runtime.origin(serverId);
      if (await ctx.ui.confirm("Remove MCP configuration?", `${serverId} (${scope})`)) { await runtime.removeServer(scope, serverId); await ctx.reload(); return; }
    }
  }
}

export function registerCommands(pi: ExtensionAPI, runtime: McpRuntime, clients: McpClients): void {
  pi.registerCommand("mcp", {
    description: "Install and manage MCP server connections",
    getArgumentCompletions: prefix => ["list", "add", "refresh", "login", "logout", "enable", "disable", "disconnect"].filter(value => value.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      try {
        const [action, id] = args.trim().split(/\s+/, 2);
        if (!action) { if (!ctx.hasUI) throw new Error("Use /mcp list in non-interactive mode"); await interactive(pi, ctx, runtime, clients); return; }
        if (action === "list") {
          const lines = Object.entries(runtime.effective.servers).map(([key, server]) => `${key}\t${server.enabled === false ? "disabled" : clients.isConnected(key) ? "connected" : "enabled"}\t${server.url}`);
          ctx.ui.notify(lines.join("\n") || "No MCP servers configured", "info"); return;
        }
        if (action === "add") { if (!ctx.hasUI) throw new Error("/mcp add requires interactive UI"); if (await addServer(ctx, runtime)) { await ctx.reload(); return; } return; }
        if (!id) throw new Error(`Usage: /mcp ${action} <server-id>`);
        if (action === "refresh") return await refreshServer(id, ctx, runtime, clients);
        if (action === "login") return await loginServer(pi, id, ctx, runtime, clients);
        if (action === "logout") { await runtime.auth.clear(id); await clients.disconnect(id); return; }
        if (action === "disconnect") return await clients.disconnect(id);
        if (action === "enable" || action === "disable") { await runtime.setEnabled(runtime.origin(id), id, action === "enable"); await ctx.reload(); return; }
        throw new Error(`Unknown /mcp action: ${action}`);
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
    },
  });

  pi.events.on("drakmyth:pi-mcp-manager:oauth-redirect", async (value: unknown) => {
    const { url } = value as { serverId: string; url: string };
    await openBrowser(pi, new URL(url));
  });
}
