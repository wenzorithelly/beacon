import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

// Beacon targets whatever repo the CLI was launched in. The CLI passes BEACON_REPO
// (the repo root) and BEACON_DATA_DIR (the per-repo store). In dev (running the app
// directly) we fall back to the surrounding git repo / parent dir.

let cachedRoot: string | null = null;

export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  if (process.env.BEACON_REPO) return (cachedRoot = process.env.BEACON_REPO);
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
  return process.env.BEACON_DATA_DIR || join(homedir(), ".beacon", repoId());
}
