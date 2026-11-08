import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentRecord, Snapshot } from "./protocol.ts";
import type { SupervisorClient } from "./client.ts";

export type Grouping = "root" | "state" | "none";
export type DashboardAction = "new" | "filter" | "stop" | "resume" | "abort" | "close";

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

export async function showDashboard(ctx: ExtensionContext, client: SupervisorClient, model: DashboardModel): Promise<DashboardAction> {
  return ctx.ui.custom<DashboardAction>((tui, theme, _keys, done) => {
    let closed = false;
    const refresh = async () => {
      try { model.update(await client.request("snapshot") as Snapshot); tui.requestRender(); } catch { /* next tick retries */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    const finish = (action: DashboardAction) => {
      if (closed) return;
      closed = true; clearInterval(timer); done(action);
    };
    return {
      render(width: number): string[] {
        const lines = [
          theme.fg("accent", theme.bold("Pi Agent View")) + theme.fg("dim", `  group: ${model.grouping}${model.filter() ? `  filter: ${model.filter()}` : ""}`),
          theme.fg("dim", "n new  / filter  g group  x stop  R resume  a abort  q quit"), "",
        ];
        const groups = model.groups();
        if (!groups.length) lines.push(theme.fg("muted", model.filter() ? "No agents match the filter." : "No agents. Press n to dispatch a task."));
        for (const group of groups) {
          lines.push(theme.fg("accent", `${group.label} (${group.agents.length})`));
          for (const agent of group.agents) {
            const selected = model.selected()?.id === agent.id;
            const attention = agent.state === "waiting" || agent.state === "failed";
            const marker = selected ? ">" : " ";
            const workspace = agent.workspace.mode === "worktree" ? agent.workspace.branch ?? "worktree" : "shared directory";
            lines.push(` ${theme.fg(selected ? "accent" : "dim", marker)} ${theme.fg(attention ? "warning" : stateColor(agent.state), stateIcon(agent.state))} ${theme.bold(agent.task)}  ${theme.fg("muted", agent.activity ?? agent.state)}  ${theme.fg("dim", `${workspace} · ${age(agent.createdAt)}`)}`);
            if (selected) lines.push(theme.fg("dim", `      ${agent.root}${agent.workspace.warning ? ` · ${agent.workspace.warning}` : ""}`));
          }
        }
        return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
      },
      invalidate() {},
      dispose() { clearInterval(timer); },
      handleInput(data: string): void {
        if (matchesKey(data, Key.up) || data === "k") model.move(-1);
        else if (matchesKey(data, Key.down) || data === "j") model.move(1);
        else if (data === "g") model.cycleGrouping();
        else if (data === "n") finish("new");
        else if (data === "/") finish("filter");
        else if (data === "x" && model.selected()) finish("stop");
        else if (data === "R" && model.selected()) finish("resume");
        else if (data === "a" && model.selected()) finish("abort");
        else if (data === "q" || matchesKey(data, Key.escape)) finish("close");
        tui.requestRender();
      },
    };
  });
}

function stateLabel(state: AgentRecord["state"]): string {
  return state === "waiting" ? "Needs input" : `${state[0]!.toUpperCase()}${state.slice(1)}`;
}
function stateIcon(state: AgentRecord["state"]): string {
  return ({ starting: "◌", running: "●", waiting: "!", idle: "○", completed: "✓", failed: "×", stopped: "■" })[state];
}
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
