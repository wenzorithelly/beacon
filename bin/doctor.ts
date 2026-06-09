#!/usr/bin/env bun
/**
 * `beacon doctor` — read-only audit. Tells the user what's wired and what isn't, both
 * globally (~/.beacon/ + ~/.claude/) and for the repo they're currently in. Existing
 * users debug a half-wired setup with this; new users see the install state changing
 * step by step.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { auditRepo } from "@/lib/assets";
import { GLOBAL_HOOKS, GLOBAL_SKILLS, auditGlobal } from "@/lib/global-install";
import { beaconHome, listWorkspaces } from "@/lib/workspaces";

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const head = (s: string) => `\n\x1b[1m${s}\x1b[0m`;

function gitToplevel(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function daemonState(): string {
  const f = join(beaconHome(), "server.json");
  try {
    const info = JSON.parse(readFileSync(f, "utf8")) as { pid?: number; port?: string };
    if (!info.pid) return bad("daemon: no server.json yet");
    try {
      process.kill(info.pid, 0);
      return ok(`daemon running (pid ${info.pid}, port ${info.port ?? "?"})`);
    } catch {
      return bad(`daemon NOT running (server.json stale: pid ${info.pid})`);
    }
  } catch {
    return bad("daemon: no server.json (never started)");
  }
}

function bunPresent(): string {
  const r = spawnSync("bun", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
  if (r.status === 0) return ok(`bun ${r.stdout.toString().trim()}`);
  return bad("bun NOT found on PATH (required to run Beacon)");
}

function repoPath(): string {
  return gitToplevel() || process.cwd();
}

const repo = repoPath();
const global = auditGlobal();
const workspaces = listWorkspaces();
const isInRegistered = workspaces.some((w) => w.path === repo);
const repoAudit = isInRegistered || existsSync(join(repo, ".mcp.json")) ? auditRepo(repo) : null;

console.log(head("Beacon · doctor"));

console.log(head("Runtime"));
console.log(`  ${bunPresent()}`);
console.log(`  ${daemonState()}`);
console.log(`  ${ok(`home: ${beaconHome()}`)}`);
console.log(`  ${ok(`workspaces registered: ${workspaces.length}`)}`);

console.log(head("Global (~/.claude/)"));
for (const name of GLOBAL_SKILLS) {
  console.log(`  ${global.skills[name] ? ok(`skill ${name}`) : bad(`skill ${name} — missing`)}`);
}
for (const h of GLOBAL_HOOKS) {
  console.log(
    `  ${
      global.hooks[h.event]
        ? ok(`hook ${h.event} → ${h.command}`)
        : bad(`hook ${h.event} → ${h.command} — missing`)
    }   ${dim(h.description)}`,
  );
}
console.log(
  `  ${
    global.claudeMdBlock
      ? ok("global CLAUDE.md block")
      : bad("global CLAUDE.md block — missing (every Claude session won't auto-discover Beacon)")
  }`,
);

console.log(head(`Current repo (${repo})`));
if (!repoAudit) {
  console.log(`  ${dim("not registered with Beacon and no .mcp.json — run `beacon` here to wire it.")}`);
} else {
  console.log(`  ${repoAudit.mcpRegistered ? ok(".mcp.json has beacon entry") : bad(".mcp.json missing beacon entry")}`);
  console.log(`  ${repoAudit.agentsMdBlock ? ok("AGENTS.md has Beacon workflow block") : bad("AGENTS.md missing Beacon workflow block")}`);
  console.log(`  ${repoAudit.claudeMdImport ? ok("CLAUDE.md @-imports AGENTS.md") : bad("CLAUDE.md does NOT @-import AGENTS.md")}`);
  console.log(`  ${repoAudit.skills["beacon-init"] ? ok("skill beacon-init (repo)") : bad("skill beacon-init (repo) — missing")}`);
  console.log(`  ${repoAudit.skills["beacon-refresh"] ? ok("skill beacon-refresh (repo)") : bad("skill beacon-refresh (repo) — missing")}`);
}

const anyMissing =
  GLOBAL_SKILLS.some((s) => !global.skills[s]) ||
  GLOBAL_HOOKS.some((h) => !global.hooks[h.event]) ||
  !global.claudeMdBlock ||
  (repoAudit
    ? !repoAudit.mcpRegistered ||
      !repoAudit.agentsMdBlock ||
      !repoAudit.claudeMdImport ||
      !repoAudit.skills["beacon-init"] ||
      !repoAudit.skills["beacon-refresh"]
    : false);

if (anyMissing) {
  console.log(`\n${dim("Fix everything marked ✗ by running")} \x1b[1mbeacon\x1b[0m ${dim("in this repo.")}`);
}
console.log();
