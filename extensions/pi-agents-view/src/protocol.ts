export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 256 * 1024;

export interface Registry {
  version: 1;
  revision: number;
  agents: AgentRecord[];
}

export interface AgentRecord {
  id: string;
  root: string;
  state: "starting" | "running" | "waiting" | "idle" | "completed" | "failed" | "stopped";
  createdAt: string;
  updatedAt: string;
}

export type RequestMethod = "health" | "snapshot" | "cancel" | "shutdown";

export interface Request {
  type: "request";
  id: string;
  method: RequestMethod;
  deadlineAt: number;
  idempotencyKey?: string;
  targetId?: string;
}

export interface Response {
  type: "response";
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface Snapshot {
  protocolVersion: number;
  pid: number;
  registry: Registry;
}
