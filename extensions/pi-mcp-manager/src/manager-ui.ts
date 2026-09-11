import { DynamicBorder, getSelectListTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import type { McpClients } from "./client.js";
import type { ResolvedServer } from "./model.js";
import type { McpRuntime } from "./runtime.js";
import { serverState, stateLabel, type ServerState } from "./status.js";

export type ManagerItem = SelectItem;

async function select(ctx: ExtensionCommandContext, title: string, details: string[], items: ManagerItem[], cancelValue?: string): Promise<string | undefined> {
  return ctx.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder(text => theme.fg("accent", text)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    for (const detail of details) container.addChild(new Text(theme.fg("dim", detail), 1, 0));
    if (details.length) container.addChild(new Text(""));

    const list = new SelectList(items, Math.min(Math.max(items.length, 1), 12), getSelectListTheme());
    list.onSelect = item => done(item.value);
    list.onCancel = () => done(cancelValue);
    container.addChild(list);
    container.addChild(new Text(theme.fg("dim", "Enter select  Esc back"), 1, 0));
    container.addChild(new DynamicBorder(text => theme.fg("accent", text)));

    return {
      render: width => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput(data) { list.handleInput(data); tui.requestRender(); },
    };
  });
}

export function serverListItems(servers: Readonly<Record<string, ResolvedServer>>, getState: (id: string, server: ResolvedServer) => ServerState): ManagerItem[] {
  const items: ManagerItem[] = Object.entries(servers).map(([id, server]) => ({
    value: `server:${id}`,
    label: server.name,
    description: `${stateLabel(getState(id, server))} - ${server.catalog.length} tools - ${server.toolMode}`,
  }));
  items.push(
    { value: "add", label: "Add server", description: "Configure a Streamable HTTP server" },
    { value: "credentials", label: "Credential profiles", description: "Manage reusable global credentials" },
    { value: "close", label: "Close" },
  );
  return items;
}

export function showServerList(ctx: ExtensionCommandContext, runtime: McpRuntime, clients: McpClients, message?: string): Promise<string | undefined> {
  const items = serverListItems(runtime.resolved.servers, (id, server) => serverState(id, server, runtime.auth, clients.runtimeState(id)));
  return select(ctx, "MCP Servers", message ? [message] : [], items, "close");
}

export function showServerDetails(ctx: ExtensionCommandContext, runtime: McpRuntime, clients: McpClients, id: string, message?: string): Promise<string | undefined> {
  const server = runtime.resolved.servers[id];
  if (!server) return Promise.resolve(undefined);
  const checked = server.catalogUpdatedAt ? `last checked ${new Date(server.catalogUpdatedAt).toLocaleString()}` : "not yet checked";
  const details = [
    `${stateLabel(serverState(id, server, runtime.auth, clients.runtimeState(id)))} - ${checked}`,
    `Authentication: ${server.oauth ? "OAuth" : Object.keys(server.headers).length ? "headers" : "none"}`,
    `Activation: ${server.toolMode}`,
    `Endpoint: ${server.url}`,
  ];
  if (message) details.unshift(message);
  return select(ctx, server.name, details, serverActionItems(server), "back");
}

export function serverActionItems(server: ResolvedServer): ManagerItem[] {
  return [
    { value: "tools", label: "Browse tools", description: `${server.catalog.length} discovered` },
    { value: "refresh", label: "Refresh catalog" },
    { value: "edit", label: "Edit connection" },
    { value: "duplicate", label: "Duplicate server" },
    ...(server.oauth ? [
      { value: "login", label: "Log in with OAuth" },
      { value: "logout", label: "Log out" },
    ] : []),
    { value: "toggle", label: server.enabled ? "Disable server" : "Enable server" },
    { value: "remove", label: "Remove configuration" },
    { value: "back", label: "Back" },
  ];
}

export function showCredentialMenu(ctx: ExtensionCommandContext): Promise<string | undefined> {
  return select(ctx, "Credential Profiles", [], [
    { value: "add", label: "Add credential profile" },
    { value: "manage", label: "Manage credential profile" },
    { value: "back", label: "Back" },
  ], "back");
}

export async function showManagerResult(ctx: ExtensionCommandContext, title: string, message: string): Promise<void> {
  await select(ctx, title, [message], [{ value: "continue", label: "Continue" }], "continue");
}
