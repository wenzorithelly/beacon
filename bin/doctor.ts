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
import { APP_EMBEDDED_CLI, beaconCliCommand } from "@/lib/agent-config";
import { auditRepo, repoMcpCliTarget } from "@/lib/assets";
import { CODEX_HOOKS, auditCodex, codexDetected, codexMcpCliTarget, codexMcpProblem } from "@/lib/codex-install";
import {
  GLOBAL_HOOKS,
  GLOBAL_SKILLS,
  auditGlobal,
  findBeaconPluginDir,
  globalHookCliTarget,
} from "@/lib/global-install";
import { beaconHome, listWorkspaces } from "@/lib/workspaces";

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const bad = (s: string) => `\x1b[31m✗\x1b[0m ${s}`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const head = (s: string) => `\n\x1b[1m${s}\x1b[0m`;

function gitToplevel(): string {
  try {
    const top = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const list = execSync("git worktree list --porcelain", { cwd: top, stdio: ["ignore", "pipe", "ignore"] }).toString();
    const primary = list.split(/\r?\n/).find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim();
    return primary || top;
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

console.log(head("Plugin (Claude Code)"));
const pluginDir = findBeaconPluginDir();
if (pluginDir) {
  console.log(`  ${ok(`installed as a Claude Code plugin → ${pluginDir}`)}`);
  console.log(`  ${dim("the plugin owns the Claude-side skills/hooks/MCP")}`);
  // With both installed, the npm layer auto-steps-aside (selfHealGlobal removes its ~/.claude entries
  // on the next `beacon` run). If they're still showing below, it hasn't run since the plugin landed.
  if (global.hooks.PostToolUse || GLOBAL_SKILLS.some((s) => global.skills[s])) {
    console.log(
      `  ${dim("npm-global ~/.claude entries still present — they'll be removed automatically on the next `beacon` run (run `beacon` once to deconflict now).")}`,
    );
  } else {
    console.log(`  ${ok("npm-global ~/.claude layer stepped aside — no double-registration")}`);
  }
} else {
  console.log(`  ${dim("not installed as a Claude Code plugin (using the npm `trybeacon` CLI).")}`);
}

console.log(head("Codex (~/.codex/ + ~/.agents/)"));
const codex = codexDetected() ? auditCodex() : null;
if (!codex) {
  console.log(`  ${dim("codex not on PATH — Codex integration inactive (wires automatically once codex is installed)")}`);
} else {
  const ver = spawnSync("codex", ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
  console.log(
    `  ${ver.status === 0 ? ok(`codex ${ver.stdout.toString().trim()}`) : dim("codex version unavailable (BEACON_CODEX override?)")}`,
  );
  for (const name of GLOBAL_SKILLS) {
    console.log(
      `  ${codex.skills[name] ? ok(`skill ${name} (~/.agents/skills)`) : bad(`skill ${name} (~/.agents/skills) — missing`)}`,
    );
  }
  for (const h of CODEX_HOOKS) {
    console.log(
      `  ${
        codex.hooks[h.event]
          ? ok(`hook ${h.event} → ${h.command}`)
          : bad(`hook ${h.event} → ${h.command} — missing`)
      }   ${dim(h.description)}`,
    );
  }
  console.log(
    `  ${codex.agentsMdBlock ? ok("global ~/.codex/AGENTS.md block") : bad("global ~/.codex/AGENTS.md block — missing")}`,
  );
  const mcpProblem = codexMcpProblem();
  console.log(
    `  ${
      codex.mcp
        ? ok("config.toml has [mcp_servers.beacon]")
        : bad(`config.toml missing [mcp_servers.beacon]${mcpProblem ? ` — ${mcpProblem}` : ""}`)
    }`,
  );
}

// ── CLI binding: which `beacon` binary do the wired configs actually invoke? ──
// The npm install points hooks + MCP at the bare `beacon` PATH shim; when Beacon.app is installed
// the app ships its own embedded shim and fresh installs point there instead. A MISMATCH (configs
// still on the npm shim after the app landed, or the reverse) means the agent integration may invoke
// a binary that isn't there — flag it so the user re-points.
console.log(head("CLI binding"));
const expectedCli = beaconCliCommand();
const appInstalled = existsSync(APP_EMBEDDED_CLI);
console.log(
  `  ${ok(`fresh installs resolve to: ${expectedCli}`)}   ${dim(
    process.env.BEACON_CLI_PATH ? "(BEACON_CLI_PATH override)" : appInstalled ? "(Beacon.app installed)" : "(npm PATH shim)",
  )}`,
);
const cliTargets: Array<[string, string | null]> = [
  ["~/.claude/settings.json hooks", globalHookCliTarget()],
];
if (codexDetected()) cliTargets.push(["~/.codex/config.toml MCP", codexMcpCliTarget()]);
if (repoAudit) cliTargets.push([`${repo}/.mcp.json`, repoMcpCliTarget(repo)]);
let cliMismatch = false;
for (const [label, actual] of cliTargets) {
  if (!actual) {
    console.log(`  ${dim(`${label}: not wired`)}`);
    continue;
  }
  if (actual === expectedCli) {
    console.log(`  ${ok(`${label} → ${actual}`)}`);
  } else {
    cliMismatch = true;
    console.log(`  ${bad(`${label} → ${actual} — MISMATCH (fresh installs would use ${expectedCli})`)}`);
  }
}
if (cliMismatch)
  console.log(
    `  ${dim("re-point the configs with")} \x1b[1mbeacon uninstall && beacon\x1b[0m ${dim(
      "(uninstall clears the old entries regardless of binary; the next `beacon` rewrites them at the resolved path).",
    )}`,
  );

console.log(head(`Current repo (${repo})`));
if (!repoAudit) {
  console.log(`  ${dim("not registered with Beacon and no .mcp.json — run `beacon` here to wire it.")}`);
} else {
  console.log(`  ${repoAudit.mcpRegistered ? ok(".mcp.json has beacon entry") : bad(".mcp.json missing beacon entry")}`);
  console.log(`  ${repoAudit.workflowBlock ? ok("AGENTS.md / CLAUDE.md has Beacon workflow block") : bad("AGENTS.md / CLAUDE.md missing Beacon workflow block")}`);
  console.log(`  ${repoAudit.skills["beacon-init"] ? ok("skill beacon-init (repo)") : bad("skill beacon-init (repo) — missing")}`);
  console.log(`  ${repoAudit.skills["beacon-refresh"] ? ok("skill beacon-refresh (repo)") : bad("skill beacon-refresh (repo) — missing")}`);
  if (codex) {
    console.log(`  ${repoAudit.codexSkills["beacon-init"] ? ok("skill beacon-init (.agents/skills)") : bad("skill beacon-init (.agents/skills) — missing")}`);
    console.log(`  ${repoAudit.codexSkills["beacon-refresh"] ? ok("skill beacon-refresh (.agents/skills)") : bad("skill beacon-refresh (.agents/skills) — missing")}`);
  }
}

const anyMissing =
  GLOBAL_SKILLS.some((s) => !global.skills[s]) ||
  GLOBAL_HOOKS.some((h) => !global.hooks[h.event]) ||
  !global.claudeMdBlock ||
  (codex
    ? GLOBAL_SKILLS.some((s) => !codex.skills[s]) ||
      CODEX_HOOKS.some((h) => !codex.hooks[h.event]) ||
      !codex.agentsMdBlock ||
      !codex.mcp
    : false) ||
  (repoAudit
    ? !repoAudit.mcpRegistered ||
      !repoAudit.workflowBlock ||
      !repoAudit.skills["beacon-init"] ||
      !repoAudit.skills["beacon-refresh"] ||
      (codex ? !repoAudit.codexSkills["beacon-init"] || !repoAudit.codexSkills["beacon-refresh"] : false)
    : false);

if (anyMissing) {
  console.log(`\n${dim("Fix everything marked ✗ by running")} \x1b[1mbeacon\x1b[0m ${dim("in this repo.")}`);
}
console.log();
