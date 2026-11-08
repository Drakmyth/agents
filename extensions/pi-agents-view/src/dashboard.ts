import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor, Key, matchesKey, truncateToWidth, type Component, type Focusable } from "@earendil-works/pi-tui";
import type { AgentRecord, Snapshot } from "./protocol.ts";
import type { SupervisorClient } from "./client.ts";

export type Grouping = "root" | "state" | "none";
export type DashboardResult =
  | { type: "dispatch"; prompt: string; root: string }
  | { type: "filter" | "stop" | "resume" | "abort" | "close" };

export class DashboardModel {
  private agents: AgentRecord[] = [];
  private selectedId?: string;
  private query = "";

  constructor(public grouping: Grouping = "root") {}

  update(snapshot: Snapshot): void {
    this.agents = snapshot.registry.agents;
    if (!this.selectedId || !this.agents.some((agent) => agent.id === this.selectedId)) this.selectedId = this.visible()[0]?.id;
  }
  setFilter(query: string): void { this.query = query.trim().toLowerCase(); this.ensureVisible(); }
  filter(): string { return this.query; }
  selected(): AgentRecord | undefined { return this.agents.find((agent) => agent.id === this.selectedId); }
  dispatchRoot(defaultRoot: string): string {
    return this.grouping === "root" ? this.selected()?.workspace.selectedRoot ?? defaultRoot : defaultRoot;
  }
  cycleGrouping(): void {
    this.grouping = this.grouping === "root" ? "state" : this.grouping === "state" ? "none" : "root";
    this.ensureVisible();
  }
  move(delta: number): void {
    const rows = this.visible();
    if (!rows.length) return;
    const index = Math.max(0, rows.findIndex((agent) => agent.id === this.selectedId));
    this.selectedId = rows[Math.max(0, Math.min(rows.length - 1, index + delta))]!.id;
  }
  groups(): Array<{ label: string; agents: AgentRecord[] }> {
    const values = this.visible();
    if (this.grouping === "none") return [{ label: "Agents", agents: values }];
    const groups = new Map<string, AgentRecord[]>();
    for (const agent of values) {
      const key = this.grouping === "root" ? agent.workspace.selectedRoot : stateLabel(agent.state);
      const group = groups.get(key) ?? [];
      group.push(agent); groups.set(key, group);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([label, agents]) => ({ label, agents }));
  }
  private visible(): AgentRecord[] {
    return this.agents.filter((agent) => !this.query || [agent.task, agent.root, agent.activity, agent.state]
      .filter(Boolean).join(" ").toLowerCase().includes(this.query))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  private ensureVisible(): void {
    if (!this.visible().some((agent) => agent.id === this.selectedId)) this.selectedId = this.visible()[0]?.id;
  }
}

export async function showDashboard(
  ctx: ExtensionContext,
  client: SupervisorClient,
  model: DashboardModel,
  dispatchRoot: string,
): Promise<DashboardResult> {
  return ctx.ui.custom<DashboardResult>((tui, theme, _keys, done) => {
    let closed = false;
    const editor = new Editor(tui, {
      borderColor: (text) => theme.fg("borderAccent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text), selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text), scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    }, { paddingX: 1 });
    editor.onSubmit = (value) => {
      const prompt = value.trim();
      if (prompt === "/quit") finish({ type: "close" });
      else if (prompt) finish({ type: "dispatch", prompt, root: model.dispatchRoot(dispatchRoot) });
    };
    const refresh = async () => {
      try { model.update(await client.request("snapshot") as Snapshot); tui.requestRender(); } catch { /* next tick retries */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    const finish = (result: DashboardResult) => {
      if (closed) return;
      closed = true; clearInterval(timer); done(result);
    };
    const view: Component & Focusable = {
      focused: true,
      render(width: number): string[] {
        const safeWidth = Math.max(1, width);
        const lines = [
          theme.fg("accent", theme.bold("Pi Agent View")) + theme.fg("dim", `  ${model.dispatchRoot(dispatchRoot)}  ·  group: ${model.grouping}${model.filter() ? `  ·  filter: ${model.filter()}` : ""}`),
          theme.fg("dim", "↑/↓ select  Ctrl+S group  Ctrl+F filter  Ctrl+X stop  Ctrl+Shift+R resume  Ctrl+Alt+X abort  Esc quit"), "",
        ];
        const groups = model.groups();
        if (!groups.length) lines.push(theme.fg("muted", model.filter() ? "No agents match the filter." : "Type a task below and press Enter."));
        for (const group of groups) {
          lines.push(theme.fg("accent", `${group.label} (${group.agents.length})`));
          for (const agent of group.agents) {
            const selected = model.selected()?.id === agent.id;
            const attention = agent.state === "waiting" || agent.state === "failed";
            const workspace = agent.workspace.mode === "worktree" ? agent.workspace.branch ?? "worktree" : "shared directory";
            lines.push(` ${theme.fg(selected ? "accent" : "dim", selected ? ">" : " ")} ${theme.fg(attention ? "warning" : stateColor(agent.state), stateIcon(agent.state))} ${theme.bold(agent.task)}  ${theme.fg("muted", agent.activity ?? agent.state)}  ${theme.fg("dim", `${workspace} · ${age(agent.createdAt)}`)}`);
            if (selected) lines.push(theme.fg("dim", `      ${agent.root}${agent.workspace.warning ? ` · ${agent.workspace.warning}` : ""}`));
          }
        }
        const editorLines = editor.render(safeWidth);
        return [...lines, "", theme.fg("dim", `New agent in ${model.dispatchRoot(dispatchRoot)}`), ...editorLines]
          .slice(-Math.max(1, tui.terminal.rows)).map((line) => truncateToWidth(line, safeWidth));
      },
      invalidate() { editor.invalidate(); },
      handleInput(data: string): void {
        if (matchesKey(data, Key.up)) model.move(-1);
        else if (matchesKey(data, Key.down)) model.move(1);
        else if (matchesKey(data, "ctrl+s")) model.cycleGrouping();
        else if (matchesKey(data, "ctrl+f")) finish({ type: "filter" });
        else if (matchesKey(data, "ctrl+x") && model.selected()) finish({ type: "stop" });
        else if (matchesKey(data, "ctrl+shift+r") && model.selected()) finish({ type: "resume" });
        else if (matchesKey(data, "ctrl+alt+x") && model.selected()) finish({ type: "abort" });
        else if (matchesKey(data, Key.escape)) {
          if (editor.getText()) editor.setText("");
          else finish({ type: "close" });
        } else editor.handleInput(data);
        tui.requestRender();
      },
    };
    Object.defineProperty(view, "focused", { get: () => editor.focused, set: (value: boolean) => { editor.focused = value; } });
    return view;
  });
}

function stateLabel(state: AgentRecord["state"]): string { return state === "waiting" ? "Needs input" : `${state[0]!.toUpperCase()}${state.slice(1)}`; }
function stateIcon(state: AgentRecord["state"]): string { return ({ starting: "◌", running: "●", waiting: "!", idle: "○", completed: "✓", failed: "×", stopped: "■" })[state]; }
function stateColor(state: AgentRecord["state"]): "success" | "warning" | "error" | "muted" {
  if (state === "failed") return "error";
  if (state === "running" || state === "starting" || state === "waiting") return "warning";
  return state === "completed" ? "success" : "muted";
}
function age(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1_000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
