import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRecord, Workspace } from "./protocol.ts";

interface Worker {
  record: AgentRecord;
  process: ChildProcessWithoutNullStreams;
  sequence: number;
  pending: Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
  settled?: () => void;
}

export class WorkerHost {
  private readonly workers = new Map<string, Worker>();

  constructor(private readonly sessionsDir: string, private readonly persist: (record: AgentRecord) => Promise<void>) {}

  async launch(id: string, root: string, workspace: Workspace, prompt?: string): Promise<AgentRecord> {
    const now = new Date().toISOString();
    const record: AgentRecord = { id, root, workspace, state: "starting", createdAt: now, updatedAt: now, activity: "Starting" };
    await this.persist(record);
    await this.start(record, ["--session-dir", join(this.sessionsDir, record.id)]);
    if (prompt?.trim()) await this.prompt(record.id, prompt);
    return record;
  }

  async resume(record: AgentRecord): Promise<AgentRecord> {
    if (!record.sessionFile) throw new Error("Agent has no persisted session");
    if (this.workers.has(record.id)) throw new Error("Agent is already running");
    await this.start(record, ["--session", record.sessionFile]);
    return record;
  }

  async prompt(id: string, message: string): Promise<AgentRecord> {
    const worker = this.require(id);
    if (!message.trim()) throw new Error("Prompt cannot be empty");
    if (worker.record.state === "running") throw new Error("Agent is already executing a turn");
    await this.rpc(worker, { type: "prompt", message: message.trim() });
    await this.update(worker, "running", "Prompt accepted");
    return worker.record;
  }

  async abort(id: string): Promise<AgentRecord> {
    const worker = this.require(id);
    await this.rpc(worker, { type: "abort" });
    worker.record.activity = "Abort requested";
    await this.persist(worker.record);
    return worker.record;
  }

  async stop(id: string): Promise<AgentRecord> {
    const worker = this.require(id);
    await terminate(worker.process);
    this.workers.delete(id);
    worker.record.pid = undefined;
    await this.update(worker, "stopped", "Stopped");
    return worker.record;
  }

  async drain(graceMs: number): Promise<void> {
    await Promise.all([...this.workers.values()].map(async (worker) => {
      if (worker.record.state === "running" || worker.record.state === "waiting") {
        await Promise.race([
          new Promise<void>((resolve) => { worker.settled = resolve; }),
          new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
        ]);
      }
      if (this.workers.has(worker.record.id)) await this.stop(worker.record.id);
    }));
  }

  has(id: string): boolean { return this.workers.has(id); }

  private async start(record: AgentRecord, sessionArgs: string[]): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    const prefixArgs = process.env.PI_AGENTS_VIEW_PI_ARGS ? JSON.parse(process.env.PI_AGENTS_VIEW_PI_ARGS) as string[] : [];
    const child = spawn(process.env.PI_AGENTS_VIEW_PI ?? "pi", [...prefixArgs, "--mode", "rpc", "--no-approve", ...sessionArgs], {
      cwd: record.root, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const worker: Worker = { record, process: child, sequence: 0, pending: new Map() };
    this.workers.set(record.id, worker);
    record.pid = child.pid;
    child.stdout.setEncoding("utf8");
    let buffer = "";
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try { this.onMessage(worker, JSON.parse(line)); } catch { void this.fail(worker, "Invalid worker output"); }
      }
    });
    child.once("error", (error) => void this.fail(worker, error.message));
    child.once("exit", (code) => {
      this.workers.delete(record.id); record.pid = undefined;
      if (record.state !== "stopped") void this.fail(worker, `Worker exited (${code ?? "unknown"})`);
    });
    const state = await this.rpc(worker, { type: "get_state" });
    if (typeof state.data?.sessionFile === "string") record.sessionFile = state.data.sessionFile;
    await this.update(worker, "idle", "Ready");
  }

  private onMessage(worker: Worker, value: any): void {
    if (value.type === "response" && typeof value.id === "string") {
      const pending = worker.pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timer); worker.pending.delete(value.id);
      value.success === false ? pending.reject(new Error(value.error ?? "Worker request failed")) : pending.resolve(value);
    } else if (value.type === "agent_start") void this.update(worker, "running", "Working");
    else if (value.type === "extension_ui_request") void this.update(worker, "waiting", value.title ?? "Waiting for input");
    else if (value.type === "tool_execution_start") void this.update(worker, "running", `Using ${value.toolName ?? "tool"}`);
    else if (value.type === "agent_settled") {
      worker.settled?.(); worker.settled = undefined;
      void this.complete(worker);
    } else if (value.type === "message_end" && value.message?.stopReason === "error") void this.fail(worker, "Agent turn failed");
  }

  private rpc(worker: Worker, command: Record<string, unknown>): Promise<any> {
    const id = `worker-${++worker.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.pending.delete(id); reject(new Error(`Worker request timed out: ${command.type}`)); }, 10_000);
      worker.pending.set(id, { resolve, reject, timer });
      worker.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  private require(id: string): Worker {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`Agent is not running: ${id}`);
    return worker;
  }

  private async complete(worker: Worker): Promise<void> {
    try {
      const state = await this.rpc(worker, { type: "get_state" });
      if (typeof state.data?.sessionFile === "string") worker.record.sessionFile = state.data.sessionFile;
      await this.update(worker, "completed", "Turn completed");
    } catch (error) { await this.fail(worker, error instanceof Error ? error.message : String(error)); }
  }

  private async update(worker: Worker, state: AgentRecord["state"], activity: string): Promise<void> {
    worker.record.state = state; worker.record.activity = activity; worker.record.updatedAt = new Date().toISOString();
    if (state !== "failed") worker.record.error = undefined;
    await this.persist(worker.record);
  }

  private async fail(worker: Worker, error: string): Promise<void> {
    worker.record.error = error;
    await this.update(worker, "failed", error);
  }
}

async function terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.stdin.end();
  await Promise.race([new Promise<void>((resolve) => child.once("exit", resolve)), new Promise<void>((resolve) => setTimeout(resolve, 500))]);
  if (child.exitCode !== null) return;
  if (child.pid) await terminatePid(child.pid);
}

export async function terminatePid(pid: number): Promise<void> {
  if (process.platform === "win32") await new Promise<void>((resolve) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => resolve()));
  else { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} } }
}
