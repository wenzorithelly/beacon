#!/usr/bin/env bun
/**
 * Beacon plugin bootstrap — DEPENDENCY-FREE (node: builtins only, no `@/…`, no npm deps).
 *
 * Every Claude Code plugin entry point routes through here: the hooks, the MCP server, and the
 * SessionStart launcher. Why a wrapper? A marketplace-installed plugin is a bare git clone — the
 * bundled CLI's lib/* modules import node_modules (next, libsql, …) that aren't present until the
 * first `bun install`, so the real `beacon` binary can't even load on a fresh install. boot runs
 * first because it touches nothing but node: builtins:
 *   1. require Bun (the CLI shebang + the daemon both need it),
 *   2. install the plugin's deps once into the plugin dir (idempotent thereafter),
 *   3. delegate to the real `beacon <sub>`, marking plugin mode.
 *
 * stdout hygiene: the MCP server speaks its protocol over stdout, so the one-time install must NOT
 * write there — its output goes to stderr only. Delegation inherits stdio so `beacon mcp` owns the
 * real stdout. boot NEVER exits non-zero from a missing prerequisite — failing a hook would break
 * the agent's turn; it warns on stderr and exits 0.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const selfDir = dirname(fileURLToPath(import.meta.url)); // <plugin>/dist/bin
const pluginRoot = dirname(dirname(selfDir)); // <plugin>
const beaconJs = join(selfDir, "beacon.js");
const args = process.argv.slice(2);
const warn = (m: string) => process.stderr.write(`[beacon] ${m}\n`);

// 1. Bun must be on PATH — the bundled CLI runs under bun (bun: APIs + top-level await) and the
//    daemon is literally `bun run start`. We don't auto-install a runtime; we point the user at it.
if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
  warn("Bun is required to run Beacon. Install it from https://bun.sh, then restart your session.");
  process.exit(0);
}

// 2. First run: a git-cloned plugin has no node_modules. Install once (output → stderr only so the
//    MCP stdout channel stays clean). Subsequent runs no-op the moment node_modules exists.
if (!existsSync(join(pluginRoot, "node_modules"))) {
  warn("first run — installing Beacon's dependencies (one time, this can take a moment)…");
  const r = spawnSync("bun", ["install", "--production"], {
    cwd: pluginRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (r.status !== 0 || !existsSync(join(pluginRoot, "node_modules"))) {
    warn(`dependency install failed — run \`bun install\` in ${pluginRoot} and retry.`);
    process.exit(0);
  }
}

// 3. Delegate to the real CLI. Mark plugin mode so the global + per-repo self-heal stays suppressed
//    even on entry paths Claude Code doesn't set CLAUDE_PLUGIN_ROOT for. stdio inherit hands the
//    child the parent's pipes — correct for the stdio MCP server and for hook stdin/stdout.
const env = { ...process.env, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || pluginRoot };
const res = spawnSync("bun", [beaconJs, ...args], { stdio: "inherit", env });
process.exit(res.status ?? 0);
