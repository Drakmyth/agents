import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createConnection } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentViewPaths } from "./paths.ts";
import type { RequestMethod, Response } from "./protocol.ts";

export class SupervisorClient {
  private sequence = 0;

  constructor(private readonly paths: AgentViewPaths) {}

  async request(method: RequestMethod, options: { timeoutMs?: number; idempotencyKey?: string; targetId?: string; leaseId?: string } = {}): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const id = `client-${process.pid}-${++this.sequence}`;
    const socket = createConnection(this.paths.endpoint);
    const response = new Promise<unknown>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Supervisor request timed out: ${method}`));
      }, timeoutMs);
      socket.setEncoding("utf8");
      socket.once("error", reject);
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timer);
        socket.end();
        const value = JSON.parse(buffer.slice(0, newline)) as Response;
        value.ok ? resolve(value.data) : reject(new Error(value.error));
      });
    });
    socket.once("connect", () => socket.write(`${JSON.stringify({
      type: "request", id, method, deadlineAt: Date.now() + timeoutMs,
      idempotencyKey: options.idempotencyKey, targetId: options.targetId, leaseId: options.leaseId,
    })}\n`));
    return response;
  }

  async acquireLease(leaseId: string): Promise<void> {
    await this.request("acquireLease", { leaseId });
  }

  async renewLease(leaseId: string): Promise<void> {
    await this.request("renewLease", { leaseId });
  }

  async releaseLease(leaseId: string): Promise<void> {
    await this.request("releaseLease", { leaseId });
  }

  async connectOrStart(): Promise<unknown> {
    try { return await this.request("health", { timeoutMs: 500 }); }
    catch {
      await this.start();
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        try { return await this.request("health", { timeoutMs: 500 }); } catch { /* retry */ }
      }
      throw new Error("Agent View supervisor did not start");
    }
  }

  private async start(): Promise<void> {
    const entry = fileURLToPath(new URL("./supervisor-entry.ts", import.meta.url));
    await access(entry);
    const loaderPath = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
    await access(loaderPath);
    const loader = pathToFileURL(loaderPath).href;
    const child = spawn(process.env.PI_AGENTS_VIEW_NODE ?? "node", ["--import", loader, entry], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PI_AGENTS_VIEW_STATE_DIR: this.paths.stateDir },
      windowsHide: true,
    });
    child.unref();
  }
}
