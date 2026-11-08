import { mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from "node:fs/promises";
import type { AgentViewPaths } from "./paths.ts";
import type { AgentRecord, Registry } from "./protocol.ts";

export class RegistryStore {
  private value: Registry = { version: 1, revision: 0, agents: [] };
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly paths: AgentViewPaths) {}

  async open(): Promise<void> {
    await mkdir(this.paths.stateDir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await readFile(this.paths.registryFile, "utf8")) as Registry;
      if (parsed.version !== 1 || !Array.isArray(parsed.agents)) throw new Error("unsupported registry format");
      this.value = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save();
    }
  }

  snapshot(): Registry {
    return structuredClone(this.value);
  }

  find(id: string): AgentRecord | undefined {
    return this.value.agents.find((agent) => agent.id === id);
  }

  async put(record: AgentRecord): Promise<void> {
    const index = this.value.agents.findIndex((agent) => agent.id === record.id);
    if (index < 0) this.value.agents.push(record);
    else this.value.agents[index] = record;
    this.value.revision++;
    await this.save();
  }

  async save(): Promise<void> {
    const value = structuredClone(this.value);
    this.writes = this.writes.then(async () => {
      const temporary = `${this.paths.registryFile}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.paths.registryFile);
    });
    await this.writes;
  }
}

export async function acquireLock(path: string): Promise<FileHandle> {
  try {
    const handle = await open(path, "wx", 0o600);
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number((await readFile(path, "utf8")).trim());
    if (Number.isSafeInteger(pid) && processAlive(pid)) throw new Error(`Supervisor is already running (pid ${pid})`);
    await rm(path, { force: true });
    return acquireLock(path);
  }
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
