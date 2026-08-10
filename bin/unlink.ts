#!/usr/bin/env bun
/**
 * `beacon unlink <path>` — undo what `beacon setup` wrote INSIDE one repository, and nothing else:
 * the `.mcp.json` beacon entry, the AGENTS.md workflow block, the CLAUDE.md block, and the
 * `.claude/skills/beacon-*` / `.agents/skills/beacon-*` directories.
 *
 * It touches NEITHER the global layer NOR ~/.beacon. Removing one workspace and uninstalling Beacon
 * are different acts: `uninstall` is the machine-wide reversal, this is the per-repo one.
 *
 * WHY A SUBCOMMAND AND NOT `uninstall --repo`. That was the first cut, and it is a landmine: an older
 * `beacon` on someone's PATH does not know the flag, drops it silently, and is left running
 * `uninstall --yes` — a full global wipe of ~/.beacon and every workspace in it. An unknown
 * SUBCOMMAND cannot do that; bin/beacon.ts's dispatch falls through to launching the panel, which
 * destroys nothing. Never hang a narrowing flag off a destructive default.
 *
 * The desktop app's "Delete workspace…" is the main caller (shell/workspace-registry-main.ts). The
 * path does not need to be a registered workspace — by the time the app calls this, it deliberately
 * is not one any more.
 *
 * Applies immediately: unlike `uninstall`, there is no dry-run default. The caller has already said
 * "delete this workspace", and a second confirmation for the half that cleans up after the first is
 * a prompt with no decision behind it. `--dry-run` is there for anyone who wants to look first.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { removeRepoAssets } from "@/lib/assets";

const raw = process.argv[3];
const dry = process.argv.includes("--dry-run");

if (!raw || raw.startsWith("-")) {
  console.error("usage: beacon unlink <path-to-repo> [--dry-run]");
  process.exit(1);
}
const repo = resolve(raw);
if (!existsSync(repo)) {
  // A repo already gone from disk has nothing left to strip — that is a success, not an error: the
  // caller (a workspace delete) has no way to put it back and should not be told its cleanup failed.
  console.log(`beacon unlink: ${repo} is not on disk — nothing to remove`);
  process.exit(0);
}

console.log(`\x1b[1mBeacon · unlink${dry ? " (dry run)" : ""} — ${repo}\x1b[0m`);
if (dry) {
  console.log("  strip beacon entry from .mcp.json, workflow block from AGENTS.md, skills, CLAUDE.md block");
  console.log("  Nothing was changed.\n");
  process.exit(0);
}

const r = removeRepoAssets(repo);
const bits: string[] = [];
if (r.skillsRemoved.length) bits.push(`skills(${r.skillsRemoved.length})`);
if (r.mcpUnregistered) bits.push(".mcp.json");
if (r.agentsBlockRemoved) bits.push("AGENTS.md");
if (r.claudeImportRemoved) bits.push("CLAUDE.md");
console.log(`  \x1b[32m✓\x1b[0m ${bits.length ? `removed ${bits.join(", ")}` : "nothing left to remove"}\n`);
