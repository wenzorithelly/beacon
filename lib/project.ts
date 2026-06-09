import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { activeWorkspace, dataDirFor, getPinnedWorkspaceId, getWorkspace } from "@/lib/workspaces";

// Beacon targets whatever repo the CLI was launched in. The CLI passes BEACON_REPO
// (the repo root) and BEACON_DATA_DIR (the per-repo store). In dev (running the app
// directly) we fall back to the surrounding git repo / parent dir. When the server has
// an active workspace selected, that wins (multi-workspace server).

let cachedRoot: string | null = null;

export function repoRoot(): string {
  // A pinned process (CLI / watcher / init) targets its own repo, ignoring the server's
  // active workspace. The unpinned daemon follows the active workspace.
  if (process.env.BEACON_REPO) return process.env.BEACON_REPO;
  // A per-request pin (runWithWorkspace, set by MCP routes) wins over the active
  // workspace so AGENTS.md is written into the agent's repo, not the dropdown's.
  const pinnedId = getPinnedWorkspaceId();
  if (pinnedId) {
    const pinned = getWorkspace(pinnedId);
    if (pinned) return pinned.path;
  }
  const ws = activeWorkspace();
  if (ws) return ws.path;
  if (cachedRoot) return cachedRoot;
  try {
    const top = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (top) return (cachedRoot = top);
  } catch {
    /* not a git repo */
  }
  return (cachedRoot = resolve(process.cwd(), "../.."));
}

export function repoName(): string {
  return basename(repoRoot());
}

export function repoId(): string {
  return createHash("sha256").update(repoRoot()).digest("hex").slice(0, 12);
}

export function dataDir(): string {
  if (process.env.BEACON_DATA_DIR) return process.env.BEACON_DATA_DIR;
  // Honor a per-request pin (MCP routes) so the disk-backed draft/plan store lands in
  // the agent's repo dir, not the browser's active one.
  const pinnedId = getPinnedWorkspaceId();
  if (pinnedId && getWorkspace(pinnedId)) return dataDirFor(pinnedId);
  const ws = activeWorkspace();
  if (ws) return dataDirFor(ws.id);
  return join(homedir(), ".beacon", repoId());
}
