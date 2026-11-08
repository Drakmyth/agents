import { createHash } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

export interface AgentViewPaths {
  stateDir: string;
  endpoint: string;
  lockFile: string;
  registryFile: string;
  logFile: string;
  sessionsDir: string;
  worktreesDir: string;
}

export function agentViewPaths(stateDir = process.env.PI_AGENTS_VIEW_STATE_DIR ?? join(homedir(), ".pi", "agent", "pi-agents-view")): AgentViewPaths {
  const root = resolve(stateDir);
  const endpoint = process.platform === "win32"
    ? `\\\\.\\pipe\\pi-agents-view-${createHash("sha256").update(`${userInfo().username}\0${root}`).digest("hex").slice(0, 24)}`
    : join(root, "supervisor.sock");
  return {
    stateDir: root,
    endpoint,
    lockFile: join(root, "supervisor.lock"),
    registryFile: join(root, "registry.json"),
    logFile: join(root, "supervisor.log"),
    sessionsDir: join(root, "sessions"),
    worktreesDir: join(root, "worktrees"),
  };
}
