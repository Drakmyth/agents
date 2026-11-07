import { chmod, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import type { AgentViewPaths } from "./paths.ts";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, type Request, type Response, type Snapshot } from "./protocol.ts";
import { acquireLock, RegistryStore } from "./registry.ts";

export interface SupervisorServerOptions {
  exitOnIdle?: boolean;
  idleDelayMs?: number;
  leaseTtlMs?: number;
}

export class SupervisorServer {
  private readonly registry: RegistryStore;
  private server?: Server;
  private lock?: Awaited<ReturnType<typeof acquireLock>>;
  private readonly replies = new Map<string, Response>();
  private readonly cancelled = new Set<string>();
  private readonly leases = new Map<string, number>();
  private idleTimer?: NodeJS.Timeout;
  private draining = false;

  constructor(private readonly paths: AgentViewPaths, private readonly options: SupervisorServerOptions = {}) {
    this.registry = new RegistryStore(paths);
  }

  async start(): Promise<void> {
    await this.registry.open();
    this.lock = await acquireLock(this.paths.lockFile);
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
    if (process.platform !== "win32") await rm(this.paths.endpoint, { force: true });
    await this.lock?.close();
    await rm(this.paths.lockFile, { force: true });
  }

  private accept(socket: Socket): void {
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
    else if (request.method === "health") response = success(request.id, { protocolVersion: PROTOCOL_VERSION, pid: process.pid, draining: this.draining });
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
      const active = [...this.leases.values()].some((expiresAt) => expiresAt > Date.now());
      if (!active) void this.close().finally(() => process.exit(0));
    }, this.options.idleDelayMs ?? 1_000);
    this.idleTimer.unref();
  }

  private send(socket: Socket, response: Response): void {
    if (socket.writable) socket.write(`${JSON.stringify(response)}\n`);
  }
}

const success = (id: string, data: unknown): Response => ({ type: "response", id, ok: true, data });
const failure = (id: string, error: string): Response => ({ type: "response", id, ok: false, error });
