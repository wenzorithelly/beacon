#!/usr/bin/env bun
/**
 * `beacon doctor` — read-only audit. Tells the user what's wired and what isn't, both
 * globally (~/.beacon/ + ~/.claude/) and for the repo they're currently in. Existing
 * users debug a half-wired setup with this; new users see the install state changing
 * step by step.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { auditRepo } from "@/lib/assets";
import { CODEX_HOOKS, auditCodex, codexDetected, codexMcpProblem } from "@/lib/codex-install";
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

// Find a Beacon install under ~/.claude/plugins (Claude Code clones a plugin to
// ~/.claude/plugins/<marketplace>/<plugin>). We scan a couple of levels for any
// .claude-plugin/plugin.json whose name is "beacon" so doctor can flag plugin installs — and warn
// when BOTH the plugin and the npm-global ~/.claude layer are present (the one double-registration
// case the CLAUDE_PLUGIN_ROOT guard can't prevent, since they're separate installs).
function findBeaconPlugin(): string | null {
  const base = join(process.env.HOME || homedir(), ".claude", "plugins");
  if (!existsSync(base)) return null;
  let level = [base];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      const manifest = join(dir, ".claude-plugin", "plugin.json");
      try {
        if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8"))?.name === "beacon") {
          return dir;
        }
      } catch {
        /* unreadable manifest — keep scanning */
      }
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.isDirectory()) next.push(join(dir, e.name));
        }
      } catch {
        /* unreadable dir — skip */
      }
    }
    level = next;
  }
  return null;
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
const pluginDir = findBeaconPlugin();
if (pluginDir) {
  console.log(`  ${ok(`installed as a Claude Code plugin → ${pluginDir}`)}`);
  console.log(`  ${dim("the plugin provides the skills/hooks/MCP; the global ~/.claude layer below is suppressed in plugin mode")}`);
  // Dual install: the plugin AND the npm-global hooks/skills both present → every hook fires twice.
  if (global.hooks.PostToolUse || GLOBAL_SKILLS.some((s) => global.skills[s])) {
    console.log(
      `  ${bad("ALSO installed via npm — ~/.claude has Beacon hooks/skills, so they DOUBLE-register with the plugin.")}`,
    );
    console.log(`  ${dim("fix: `beacon uninstall` to drop the npm-global layer, or `/plugin uninstall beacon`.")}`);
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

console.log(head(`Current repo (${repo})`));
if (!repoAudit) {
  console.log(`  ${dim("not registered with Beacon and no .mcp.json — run `beacon` here to wire it.")}`);
} else {
  console.log(`  ${repoAudit.mcpRegistered ? ok(".mcp.json has beacon entry") : bad(".mcp.json missing beacon entry")}`);
  console.log(`  ${repoAudit.agentsMdBlock ? ok("AGENTS.md has Beacon workflow block") : bad("AGENTS.md missing Beacon workflow block")}`);
  console.log(`  ${repoAudit.claudeMdImport ? ok("CLAUDE.md @-imports AGENTS.md") : bad("CLAUDE.md does NOT @-import AGENTS.md")}`);
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
      !repoAudit.agentsMdBlock ||
      !repoAudit.claudeMdImport ||
      !repoAudit.skills["beacon-init"] ||
      !repoAudit.skills["beacon-refresh"] ||
      (codex ? !repoAudit.codexSkills["beacon-init"] || !repoAudit.codexSkills["beacon-refresh"] : false)
    : false);

if (anyMissing) {
  console.log(`\n${dim("Fix everything marked ✗ by running")} \x1b[1mbeacon\x1b[0m ${dim("in this repo.")}`);
}
console.log();
