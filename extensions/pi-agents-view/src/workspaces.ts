import { execFile } from "node:child_process";
import { mkdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { Workspace } from "./protocol.ts";

const execFileAsync = promisify(execFile);

export async function prepareWorkspace(selectedRoot: string, id: string, worktreesDir: string): Promise<{ root: string; workspace: Workspace }> {
  const selected = await realpath(selectedRoot);
  if (!(await stat(selected)).isDirectory()) throw new Error("Agent root is not a directory");
  const repositoryRoot = await gitRoot(selected);
  if (!repositoryRoot) return {
    root: selected,
    workspace: {
      mode: "directory", selectedRoot: selected, path: selected, managed: false,
      warning: "Non-Git directory is shared; concurrent agents may conflict",
    },
  };

  const baseCommit = (await git(repositoryRoot, ["rev-parse", "HEAD"])).trim();
  if (!baseCommit) throw new Error("Git repository HEAD does not name a commit");
  const branch = `pi-agents-view/${id}`;
  const checkout = join(worktreesDir, id);
  await mkdir(dirname(checkout), { recursive: true });
  try {
    await git(repositoryRoot, ["worktree", "add", "-b", branch, checkout, baseCommit], 20_000);
  } catch (error) {
    throw new Error(`Could not create isolated worktree: ${error instanceof Error ? error.message : String(error)}`);
  }
  const subdirectory = relative(repositoryRoot, selected);
  const root = resolve(checkout, subdirectory);
  if (!inside(checkout, root)) throw new Error("Selected root is outside its Git repository");
  return {
    root,
    workspace: { mode: "worktree", selectedRoot: selected, path: checkout, repositoryRoot, branch, baseCommit, managed: true },
  };
}

export async function inspectManagedWorkspace(workspace: Workspace): Promise<{ removable: boolean; reason?: string }> {
  if (workspace.mode !== "worktree" || !workspace.managed || !workspace.repositoryRoot) return { removable: false, reason: "Workspace is not managed" };
  try {
    const status = await git(workspace.path, ["status", "--porcelain=v1", "--untracked-files=all"]);
    if (status.trim()) return { removable: false, reason: "Worktree has uncommitted changes" };
    if (workspace.baseCommit) {
      const head = (await git(workspace.path, ["rev-parse", "HEAD"])).trim();
      if (head !== workspace.baseCommit) return { removable: false, reason: "Worktree contains commits or divergent history" };
    }
    return { removable: true };
  } catch (error) {
    return { removable: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function git(cwd: string, args: string[], timeout = 5_000): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", cwd, ...args], { timeout, maxBuffer: 1024 * 1024, windowsHide: true });
    return result.stdout;
  } catch (error) {
    const detail = error as Error & { stderr?: string };
    throw new Error(detail.stderr?.trim() || detail.message);
  }
}

async function gitRoot(cwd: string): Promise<string | undefined> {
  try {
    const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
    return root ? await realpath(root) : undefined;
  } catch { return undefined; }
}

function inside(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || value !== ".." && !value.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(value);
}
