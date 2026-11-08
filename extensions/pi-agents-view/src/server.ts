import { randomUUID } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import type { AgentViewPaths } from "./paths.ts";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type Request, type Response, type Snapshot } from "./protocol.ts";
import { acquireLock, processAlive, RegistryStore } from "./registry.ts";
import { terminatePid, WorkerHost } from "./workers.ts";
import { prepareWorkspace } from "./workspaces.ts";

export interface SupervisorServerOptions {
  exitOnIdle?: boolean;
  idleDelayMs?: number;
  leaseTtlMs?: number;
  drainGraceMs?: number;
  onIdleExit?: () => void;
}

export class SupervisorServer {
  private readonly registry: RegistryStore;
  private readonly workers: WorkerHost;
  private server?: Server;
  private lock?: Awaited<ReturnType<typeof acquireLock>>;
  private readonly replies = new Map<string, Response>();
  private readonly cancelled = new Set<string>();
  private readonly sockets = new Set<Socket>();
  private readonly leases = new Map<string, number>();
  private idleTimer?: NodeJS.Timeout;
  private draining = false;

  constructor(private readonly paths: AgentViewPaths, private readonly options: SupervisorServerOptions = {}) {
    this.registry = new RegistryStore(paths);
    this.workers = new WorkerHost(paths.sessionsDir, async (record) => {
      await this.registry.put(record);
      this.broadcast();
    });
  }

  async start(): Promise<void> {
    await this.registry.open();
    this.lock = await acquireLock(this.paths.lockFile);
    for (const record of this.registry.snapshot().agents) {
      if (record.pid && processAlive(record.pid)) await terminatePid(record.pid);
      if (["starting", "running", "waiting", "idle"].includes(record.state)) {
        record.pid = undefined; record.state = "failed"; record.error = "Supervisor restarted; resume the persisted session";
        record.activity = "Interrupted"; record.updatedAt = new Date().toISOString();
        await this.registry.put(record);
      }
    }
    if (process.platform !== "win32") await rm(this.paths.endpoint, { force: true });
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.paths.endpoint, resolve);
    });
    if (process.platform !== "win32") await chmod(this.paths.endpoint, 0o600);
    this.scheduleIdleCheck();
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    await this.workers.drain(this.options.drainGraceMs ?? 30_000);
    if (process.platform !== "win32") await rm(this.paths.endpoint, { force: true });
    await this.lock?.close();
    await rm(this.paths.lockFile, { force: true });
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) return socket.destroy(new Error("Message too large"));
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        void this.handle(socket, line);
      }
    });
  }

  private async handle(socket: Socket, line: string): Promise<void> {
    let request: Request;
    try { request = JSON.parse(line) as Request; }
    catch { return this.send(socket, { type: "response", id: "invalid", ok: false, error: "Invalid JSON" }); }
    if (!request.id || request.type !== "request") return;
    if (request.deadlineAt <= Date.now()) return this.send(socket, failure(request.id, "Request deadline exceeded"));
    if (request.idempotencyKey && this.replies.has(request.idempotencyKey)) return this.send(socket, this.replies.get(request.idempotencyKey)!);

    try {
      let response: Response;
      if (request.method === "cancel") {
      if (request.targetId) this.cancelled.add(request.targetId);
      response = success(request.id, { cancelled: request.targetId });
    } else if (request.method === "acquireLease") {
      const leaseId = request.leaseId || request.id;
      this.leases.set(leaseId, Date.now() + (this.options.leaseTtlMs ?? 15_000));
      this.draining = false;
      this.scheduleIdleCheck();
      response = success(request.id, { leaseId });
    } else if (request.method === "renewLease" && request.leaseId && this.leases.has(request.leaseId)) {
      this.leases.set(request.leaseId, Date.now() + (this.options.leaseTtlMs ?? 15_000));
      this.scheduleIdleCheck();
      response = success(request.id, { leaseId: request.leaseId });
    } else if (request.method === "releaseLease" && request.leaseId) {
      this.leases.delete(request.leaseId);
      this.scheduleIdleCheck();
      response = success(request.id, { released: request.leaseId });
    } else if (request.method === "renewLease") response = failure(request.id, "Lease is not active");
    else if (this.cancelled.delete(request.id)) response = failure(request.id, "Request cancelled");
    else if (request.method === "launch") {
      if (this.draining) throw new Error("Supervisor is draining");
      const payload = request.payload as { root?: string; prompt?: string } | undefined;
      if (!payload?.root) throw new Error("Agent root is required");
      const id = randomUUID();
      const prepared = await prepareWorkspace(payload.root, id, this.paths.worktreesDir);
      response = success(request.id, await this.workers.launch(id, prepared.root, prepared.workspace, payload.prompt));
    } else if (request.method === "prompt") {
      if (this.draining) throw new Error("Supervisor is draining");
      const payload = request.payload as { id?: string; message?: string } | undefined;
      response = success(request.id, await this.workers.prompt(payload?.id ?? "", payload?.message ?? ""));
    } else if (request.method === "abort") {
      response = success(request.id, await this.workers.abort((request.payload as { id?: string })?.id ?? ""));
    } else if (request.method === "stop") {
      response = success(request.id, await this.workers.stop((request.payload as { id?: string })?.id ?? ""));
    } else if (request.method === "resume") {
      const id = (request.payload as { id?: string })?.id ?? "";
      const record = this.registry.find(id);
      if (!record) throw new Error(`Unknown agent: ${id}`);
      response = success(request.id, await this.workers.resume(record));
    } else if (request.method === "health") response = success(request.id, { protocolVersion: PROTOCOL_VERSION, pid: process.pid, draining: this.draining });
    else if (request.method === "snapshot") response = success(request.id, this.snapshot());
    else if (request.method === "shutdown") {
      response = success(request.id, { shuttingDown: true });
      this.send(socket, response);
      setTimeout(() => void this.close().finally(() => process.exit(0)), 20).unref();
      return;
    } else response = failure(request.id, "Unknown request method");

      if (request.idempotencyKey) {
        this.replies.set(request.idempotencyKey, response);
        if (this.replies.size > 256) this.replies.delete(this.replies.keys().next().value!);
      }
      this.send(socket, response);
    } catch (error) {
      this.send(socket, failure(request.id, error instanceof Error ? error.message : String(error)));
    }
  }

  private snapshot(): Snapshot {
    return { protocolVersion: PROTOCOL_VERSION, pid: process.pid, draining: this.draining, registry: this.registry.snapshot() };
  }

  private scheduleIdleCheck(): void {
    if (!this.options.exitOnIdle) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const now = Date.now();
    for (const [id, expiresAt] of this.leases) if (expiresAt <= now) this.leases.delete(id);
    if (this.leases.size) return;
    this.draining = true;
    this.idleTimer = setTimeout(() => {
      const activeLease = [...this.leases.values()].some((expiresAt) => expiresAt > Date.now());
      if (activeLease) return;
      if (this.workers.hasActiveTurns()) {
        this.scheduleIdleCheck();
        return;
      }
      void this.close().finally(() => (this.options.onIdleExit ?? (() => process.exit(0)))());
    }, this.options.idleDelayMs ?? 1_000);
    this.idleTimer.unref();
  }

  private send(socket: Socket, response: Response): void {
    if (socket.writable) socket.write(`${JSON.stringify(response)}\n`);
  }

  private broadcast(): void {
    const message = `${JSON.stringify({ type: "snapshot", data: this.snapshot() })}\n`;
    for (const socket of this.sockets) if (socket.writable) socket.write(message);
  }
}

const success = (id: string, data: unknown): Response => ({ type: "response", id, ok: true, data });
const failure = (id: string, error: string): Response => ({ type: "response", id, ok: false, error });
