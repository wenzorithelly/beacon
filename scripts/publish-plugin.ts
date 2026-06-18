#!/usr/bin/env bun
/**
 * Publish the built plugin (dist-plugin/) to the PUBLIC marketplace repo (wenzorithelly/beacon-plugin).
 *
 * Run AFTER `bun run build:release` (or `build:plugin`) so dist-plugin/ holds a fresh build. We clone
 * the marketplace repo into a temp dir, replace its tracked content with dist-plugin/, commit, and
 * push — robust because `build:plugin` rm -rf's dist-plugin/ on every run (so a nested .git there
 * can't survive). The private source repo is never touched; only the compiled artifacts go public.
 *
 * Idempotent: nothing changed → no commit. Pass --tag to also create the `beacon--v<version>` release
 * tag (what Claude Code uses to pin a marketplace plugin version).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist-plugin");
const REMOTE = "git@github.com:wenzorithelly/beacon-plugin.git";

if (!existsSync(join(DIST, ".claude-plugin", "marketplace.json"))) {
  console.error("[publish-plugin] dist-plugin/ not built — run `bun run build:release` first.");
  process.exit(1);
}
const version = (JSON.parse(readFileSync(join(DIST, "package.json"), "utf8")) as { version: string }).version;

function git(args: string[], cwd: string, allowFail = false): number {
  const r = spawnSync("git", args, { cwd, stdio: "inherit" });
  if (r.status !== 0 && !allowFail) {
    console.error(`[publish-plugin] git ${args.join(" ")} failed`);
    process.exit(1);
  }
  return r.status ?? 0;
}

const work = mkdtempSync(join(tmpdir(), "beacon-plugin-pub-"));
try {
  git(["clone", "--depth", "1", REMOTE, work], ROOT);
  // Replace tracked content with the fresh build (keep .git so history + tags persist).
  for (const e of readdirSync(work)) if (e !== ".git") rmSync(join(work, e), { recursive: true, force: true });
  for (const e of readdirSync(DIST)) cpSync(join(DIST, e), join(work, e), { recursive: true });

  git(["add", "-A"], work);
  const nothing = git(["diff", "--cached", "--quiet"], work, true) === 0;
  if (nothing) {
    console.log(`[publish-plugin] no changes — marketplace already at v${version}.`);
  } else {
    git(["commit", "-m", `Beacon Claude Code plugin v${version}`], work);
    git(["push", "origin", "HEAD:main"], work);
    console.log(`[publish-plugin] published v${version} → ${REMOTE}`);
  }
  if (process.argv.includes("--tag")) {
    git(["tag", "-f", `beacon--v${version}`], work);
    git(["push", "-f", "origin", `beacon--v${version}`], work);
    console.log(`[publish-plugin] tagged beacon--v${version}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
