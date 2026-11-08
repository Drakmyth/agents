export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 256 * 1024;

export interface Registry {
  version: 1;
  revision: number;
  agents: AgentRecord[];
}

export interface Workspace {
  mode: "worktree" | "directory";
  selectedRoot: string;
  path: string;
  repositoryRoot?: string;
  branch?: string;
  baseCommit?: string;
  managed: boolean;
  warning?: string;
}

export interface AgentRecord {
  id: string;
  root: string;
  workspace: Workspace;
  task: string;
  state: "starting" | "running" | "waiting" | "idle" | "completed" | "failed" | "stopped";
  createdAt: string;
  updatedAt: string;
  sessionFile?: string;
  pid?: number;
  activity?: string;
  error?: string;
}

export type RequestMethod = "health" | "snapshot" | "launch" | "prompt" | "abort" | "stop" | "resume" | "acquireLease" | "renewLease" | "releaseLease" | "cancel" | "shutdown";

export interface Request {
  type: "request";
  id: string;
  method: RequestMethod;
  deadlineAt: number;
  idempotencyKey?: string;
  targetId?: string;
  leaseId?: string;
  payload?: unknown;
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
  draining: boolean;
  registry: Registry;
}
