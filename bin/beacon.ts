#!/usr/bin/env bun
/**
 * Beacon CLI — run `beacon` in any repo to open it in the local control panel.
 * One shared Beacon server (daemon) serves every repo you've opened; each repo keeps
 * its own data in ~/.beacon/<id>/. `beacon` registers the current repo, makes sure the
 * daemon + a per-repo watcher are running, then opens the browser on that repo.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at <root>/bin/beacon.ts in the repo, but at <root>/dist/bin/beacon.js in a
// published build (bun build mirrors the source tree under dist/). So when our parent dir is
// `dist`, we're the packaged CLI and the package root is one level higher. In packaged mode the
// daemon runs the PRODUCTION server (`next start`) and Beacon modules load from dist/, not src.
const selfDir = dirname(fileURLToPath(import.meta.url)); // <root>/bin | <root>/dist/bin
const PACKAGED = basename(dirname(selfDir)) === "dist";
const pkgDir = PACKAGED ? dirname(dirname(selfDir)) : dirname(selfDir);
const cwd = process.cwd();
const BEACON_HOME = process.env.BEACON_HOME || join(homedir(), ".beacon");
const SERVER_FILE = join(BEACON_HOME, "server.json");
const PORT = process.env.PORT || "4319";

// The in-process db provisioner (lib/drizzle/provision) and the spawned server both resolve
// migrations from here — import.meta.url is unreliable once bundled / inside `.next`.
if (!process.env.BEACON_MIGRATIONS_DIR) process.env.BEACON_MIGRATIONS_DIR = join(pkgDir, "drizzle");

// Resolve a Beacon module by its source-relative path. Dev runs the TS sources directly; a
// published build runs the minified bundles under dist/, which mirror the source tree
// (bin/mcp.ts → dist/bin/mcp.js, lib/assets.ts → dist/lib/assets.js).
function mod(rel: string): string {
  if (!PACKAGED) return join(pkgDir, rel);
  return join(pkgDir, "dist", rel.replace(/\.ts$/, ".js"));
}

// Subcommands. Anything not listed falls through to `launchPanel()`, which opens the
// browser-side control panel for the current repo (the everyday `beacon` usage).
//   beacon mcp        — MCP stdio server (Claude Code spawns it via .mcp.json, Codex via ~/.codex/config.toml)
//   beacon hook       — PostToolUse hook handler (reports edits to the active feature)
//   beacon plan       — PermissionRequest hook handler (pipes ExitPlanMode → /plan)
//   beacon prompt     — UserPromptSubmit hook handler (nudges the feature loop)
//   beacon stop-hook  — Stop hook handler (nudges prose plan-approval → present on /plan)
//   beacon stop       — stop the shared daemon
//   beacon remove     — delete a workspace (unregister + wipe its ~/.beacon/<id>/ data)
//   beacon setup      — (re-)install per-repo skills + .mcp.json in CWD
//   beacon doctor     — audit install state (global hooks/skills + this repo's wiring)
//   beacon uninstall  — reverse every Beacon artifact (global + per-repo)
const sub = process.argv[2];
if (sub === "mcp") {
  await import(mod("bin/mcp.ts"));
} else if (sub === "hook") {
  await import(mod("bin/hook.ts"));
} else if (sub === "plan") {
  await import(mod("bin/plan.ts"));
} else if (sub === "prompt") {
  await import(mod("bin/prompt.ts"));
} else if (sub === "stop-hook") {
  await import(mod("bin/stop-hook.ts"));
} else if (sub === "stop") {
  stopDaemon();
} else if (sub === "remove") {
  await import(mod("bin/remove.ts"));
} else if (sub === "setup") {
  await setupRepo(gitToplevel() || cwd);
} else if (sub === "doctor") {
  await import(mod("bin/doctor.ts"));
} else if (sub === "uninstall") {
  await import(mod("bin/uninstall.ts"));
} else {
  await launchPanel();
}

// Install Beacon's helpers into a repo: skills + the MCP server registration.
// The user's agent sessions (Claude Code, Codex) then have:
//   • /beacon-init — read this repo and map it into Beacon (replaces the old `beacon init` CLI)
//   • /beacon-db-design — design schema for a feature and preview on /db
//   • beacon_* MCP tools — read the map, propose plans, register feature work
async function setupRepo(repo: string, quiet = false) {
  const { installInitSkill, installRefreshSkill, installCodexRepoSkills, ensureMcp, ensureWorkflowDoc } =
    await import(mod("lib/assets.ts"));
  const { selfHealGlobal } = await import(mod("lib/global-install.ts"));
  const { codexDetected } = await import(mod("lib/codex-install.ts"));
  // `beacon setup` is the explicit fix-it command — heal the global ~/.claude/ layer
  // (and ~/.codex when the Codex CLI is installed) here too so a user running it after
  // a manual cleanup doesn't have to also run bare `beacon` to re-trigger
  // launchPanel's global install.
  const heal = await selfHealGlobal();
  const initSkill = installInitSkill(repo);
  const refreshSkill = installRefreshSkill(repo);
  ensureWorkflowDoc(repo);
  const mcp = ensureMcp(repo);
  // Codex reads repo AGENTS.md natively (no @import needed) and its MCP entry is
  // global (~/.codex/config.toml, written by the heal above) — only the repo-level
  // skills under .agents/skills are per-repo.
  const codexSkills: string[] = codexDetected() ? installCodexRepoSkills(repo) : [];
  if (quiet) {
    if (mcp.added) {
      console.log(
        `[beacon] registered Beacon MCP in ${mcp.path} — restart your agent CLI to use @beacon mentions.`,
      );
    }
  } else {
    console.log(`\n  ◉ Beacon setup · ${repo}`);
    console.log(`  ✓ skill:  ${initSkill}`);
    console.log(`  ✓ skill:  ${refreshSkill}`);
    for (const s of codexSkills) console.log(`  ✓ skill:  ${s}`);
    console.log(`  ${mcp.added ? "✓ added " : "· kept  "} Beacon MCP in ${mcp.path}`);
    console.log(`  → in this repo, run /beacon-init in your agent (Claude Code or Codex) to map the repo.\n`);
  }
  return { initSkill, refreshSkill, mcp, codexSkills, heal };
}

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function urlOk(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await urlOk(url)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Start the shared server detached (survives this CLI exiting) and record its pid+port.
function startDaemon(): { pid: number; port: string } {
  mkdirSync(BEACON_HOME, { recursive: true });
  const log = openSync(join(BEACON_HOME, "server.log"), "a");
  // No BEACON_REPO → the server follows the active workspace (multi-workspace mode).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT,
    BEACON_NO_OPEN: "1",
    BEACON_MIGRATIONS_DIR: join(pkgDir, "drizzle"),
  };
  delete env.BEACON_REPO;
  delete env.BEACON_DATA_DIR;
  delete env.DATABASE_URL;
  // Packaged: serve the prebuilt `.next` in production (`next start`). Repo: hot-reloading dev.
  const args = PACKAGED ? ["run", "start"] : ["run", "dev"];
  const child = spawn("bun", args, {
    cwd: pkgDir,
    env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  const info = { pid: child.pid ?? 0, port: PORT };
  writeFileSync(SERVER_FILE, JSON.stringify(info));
  return info;
}

async function ensureDaemon(): Promise<string> {
  const existing = readJson<{ pid: number; port: string }>(SERVER_FILE);
  if (existing && isAlive(existing.pid) && (await urlOk(`http://localhost:${existing.port}/api/workspace`))) {
    return existing.port;
  }
  console.log("[beacon] starting the Beacon server…");
  const { port } = startDaemon();
  const ready = await waitForUrl(`http://localhost:${port}/api/workspace`);
  if (!ready) console.log("[beacon] (server is taking a while — it may still be compiling)");
  return port;
}

function openBrowser(url: string) {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no browser opener available */
  }
}

async function launchPanel() {
  const repo = gitToplevel() || cwd;
  const { registerWorkspaceExplicit, idForPath, dataDirFor, ensureWorkspaceDb, isRegistrableWorkspacePath } =
    await import(mod("lib/workspaces.ts"));
  if (!isRegistrableWorkspacePath(repo)) {
    console.error(
      `[beacon] refusing to open Beacon in ${repo} — that's your home directory, not a project.\n` +
        "          cd into a repo (or run `git init` there) and try again.",
    );
    process.exit(1);
  }
  const id = idForPath(repo);
  const data = dataDirFor(id);

  // First run for this repo: create its database (in-process via libSQL — see
  // lib/drizzle/provision) + install Beacon's agent helpers.
  const firstRun = !existsSync(join(data, "db.sqlite"));
  if (firstRun) console.log(`[beacon] first run for ${repo} — creating database…`);
  const provisioned = await ensureWorkspaceDb(id);
  if (!provisioned.ok) {
    console.error(`[beacon] failed to provision database: ${provisioned.error}`);
  }
  if (firstRun) {
    console.log(
      "[beacon] tip: already have code here? run `/beacon-init` in your agent (Claude Code or Codex) to map the project.",
    );
  }

  // Always ensure Beacon's agent helpers are installed (idempotent): the skills + the
  // MCP registration, so @beacon mentions + the plan loop work in this repo. The
  // selfHeal inside also wires the GLOBAL layers — ~/.claude/ always, ~/.codex/ +
  // ~/.agents/ when the Codex CLI is detected. Prints only what actually changed.
  const { heal: g } = await setupRepo(repo, true);
  const globalChanges: string[] = [];
  if (g.skillsAdded.length) globalChanges.push(`skills ${g.skillsAdded.join(", ")}`);
  if (g.hooksAdded) globalChanges.push(`${g.hooksAdded} Claude Code hook${g.hooksAdded === 1 ? "" : "s"}`);
  if (g.claudeMdBlockTouched) globalChanges.push("global CLAUDE.md block");
  if (globalChanges.length)
    console.log(`[beacon] wired into ~/.claude/: ${globalChanges.join(" + ")}.`);
  const c = g.codex;
  if (c) {
    const codexChanges: string[] = [];
    if (c.skillsAdded.length) codexChanges.push(`skills ${c.skillsAdded.join(", ")}`);
    if (c.hooksAdded) codexChanges.push(`${c.hooksAdded} Codex hook${c.hooksAdded === 1 ? "" : "s"}`);
    if (c.agentsMdBlockTouched) codexChanges.push("global AGENTS.md block");
    if (c.mcp.added) codexChanges.push("MCP entry in config.toml");
    if (codexChanges.length)
      console.log(`[beacon] wired into ~/.codex/: ${codexChanges.join(" + ")}.`);
    if (c.mcp.error) console.log(`[beacon] codex MCP not wired: ${c.mcp.error}`);
  }

  // Register the repo, ensure the shared server, then open the browser straight onto this
  // repo (activate makes it the server's active workspace). The intel pipeline is MANUAL —
  // the user triggers it from Settings → "Sync code map" when they want fresh data.
  // Explicit register: opening a repo with `beacon` clears any prior deletion tombstone.
  registerWorkspaceExplicit(repo);
  const port = await ensureDaemon();
  void data;
  const activate = `http://localhost:${port}/api/workspace/activate?id=${id}&redirect=/map`;

  console.log(
    `\n  ◉ Beacon\n  repo:  ${repo}\n  data:  ${data}\n  url:   http://localhost:${port}\n`,
  );
  console.log("  (the server keeps running in the background — `beacon stop` to stop it)\n");
  openBrowser(activate);
}

function stopDaemon() {
  const info = readJson<{ pid: number }>(SERVER_FILE);
  if (info && isAlive(info.pid)) {
    try {
      // The daemon is spawned detached → it leads its own process GROUP. Signal the group:
      // killing only the leader orphans the next-server child, which keeps holding write
      // locks on the workspace dbs for hours (agents then see opaque SQLITE_BUSY 500s).
      try {
        process.kill(-info.pid);
      } catch {
        process.kill(info.pid);
      }
      console.log(`[beacon] stopped the server (pid ${info.pid}).`);
    } catch {
      console.log("[beacon] could not stop the server.");
    }
  } else {
    console.log("[beacon] no server running.");
  }
}
