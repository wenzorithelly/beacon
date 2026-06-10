#!/usr/bin/env bun
/**
 * `beacon uninstall` — reverse every Beacon artifact on the machine:
 *   • Global:  ~/.beacon/, ~/.claude/skills/beacon-*, ~/.claude/settings.json hooks,
 *              ~/.claude/CLAUDE.md Beacon block
 *   • Codex:   ~/.codex/hooks.json entries, the [mcp_servers.beacon] block in
 *              ~/.codex/config.toml (only when we wrote it), the ~/.codex/AGENTS.md
 *              block, ~/.agents/skills/beacon-*
 *   • Per-repo (every workspace in workspaces.json): .mcp.json beacon entry, AGENTS.md
 *              workflow block, CLAUDE.md @-import if it was the only content, the
 *              .claude/skills/beacon-* and .agents/skills/beacon-* directories
 *
 * Defaults to a dry run that lists what WILL be removed. Pass `--yes` to actually do it.
 * The CLI binary itself (the cloned source tree on disk + the symlink on PATH) is NOT
 * removed by this command — the shell installer is in charge of that.
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { removeRepoAssets } from "@/lib/assets";
import { CODEX_HOOKS, auditCodex, removeCodexArtifacts } from "@/lib/codex-install";
import { GLOBAL_HOOKS, GLOBAL_SKILLS, auditGlobal, removeBeaconArtifacts } from "@/lib/global-install";
import { beaconHome, listWorkspaces } from "@/lib/workspaces";

const args = process.argv.slice(3); // process.argv[2] is "uninstall"
const apply = args.includes("--yes") || args.includes("-y");

const ok = (s: string) => `\x1b[32m✓\x1b[0m ${s}`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const head = (s: string) => `\n\x1b[1m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m!\x1b[0m ${s}`;

const home = beaconHome();
const workspaces = listWorkspaces();
const global = auditGlobal();

console.log(head(apply ? "Beacon · uninstall" : "Beacon · uninstall (dry run)"));

console.log(head("Global"));
console.log(`  ${existsSync(home) ? `wipe ${home} (${workspaces.length} workspaces)` : `${dim(`${home} — already gone`)}`}`);
for (const name of GLOBAL_SKILLS) {
  console.log(
    `  ${global.skills[name] ? `remove ~/.claude/skills/${name}/` : dim(`skill ${name} — already gone`)}`,
  );
}
for (const h of GLOBAL_HOOKS) {
  console.log(
    `  ${
      global.hooks[h.event]
        ? `remove hook ${h.event} → ${h.command}`
        : dim(`hook ${h.event} → ${h.command} — already gone`)
    }`,
  );
}
console.log(
  `  ${global.claudeMdBlock ? "strip Beacon block from ~/.claude/CLAUDE.md" : dim("global CLAUDE.md block — already gone")}`,
);

// Codex artifacts are audited regardless of whether the codex binary is still
// installed — leftovers should be removable after codex itself is gone.
const codex = auditCodex();
console.log(head("Codex"));
for (const name of GLOBAL_SKILLS) {
  console.log(
    `  ${codex.skills[name] ? `remove ~/.agents/skills/${name}/` : dim(`skill ${name} — already gone`)}`,
  );
}
for (const h of CODEX_HOOKS) {
  console.log(
    `  ${
      codex.hooks[h.event]
        ? `remove hook ${h.event} → ${h.command} from ~/.codex/hooks.json`
        : dim(`hook ${h.event} → ${h.command} — already gone`)
    }`,
  );
}
console.log(
  `  ${codex.agentsMdBlock ? "strip Beacon block from ~/.codex/AGENTS.md" : dim("global ~/.codex/AGENTS.md block — already gone")}`,
);
console.log(
  `  ${codex.mcp ? "strip [mcp_servers.beacon] from ~/.codex/config.toml (if Beacon wrote it)" : dim("config.toml beacon entry — already gone")}`,
);

if (workspaces.length) {
  console.log(head(`Per-repo (${workspaces.length})`));
  for (const w of workspaces) {
    if (!existsSync(w.path)) {
      console.log(`  ${dim(`${w.path} — repo no longer on disk, skipping`)}`);
      continue;
    }
    console.log(`  ${w.path}`);
    console.log(`     ${dim("strip beacon entry from .mcp.json, workflow block from AGENTS.md, skills, CLAUDE.md @-import")}`);
  }
}

if (!apply) {
  console.log(head("Nothing was changed."));
  console.log(`  Run \x1b[1mbeacon uninstall --yes\x1b[0m to apply.`);
  console.log(`  The \x1b[1mbeacon\x1b[0m binary itself (the cloned source + your PATH symlink) is NOT removed by this — your install script handles that.\n`);
  process.exit(0);
}

console.log(head("Applying…"));

// Global.
const g = removeBeaconArtifacts();
if (g.skillsRemoved.length) console.log(`  ${ok(`removed skills: ${g.skillsRemoved.join(", ")}`)}`);
if (g.hooksRemoved) console.log(`  ${ok(`removed ${g.hooksRemoved} hook${g.hooksRemoved === 1 ? "" : "s"} from ~/.claude/settings.json`)}`);
if (g.claudeMdBlockRemoved) console.log(`  ${ok("stripped Beacon block from ~/.claude/CLAUDE.md")}`);

// Codex.
const c = removeCodexArtifacts();
if (c.skillsRemoved.length) console.log(`  ${ok(`removed ~/.agents/skills: ${c.skillsRemoved.join(", ")}`)}`);
if (c.hooksRemoved) console.log(`  ${ok(`removed ${c.hooksRemoved} hook${c.hooksRemoved === 1 ? "" : "s"} from ~/.codex/hooks.json`)}`);
if (c.agentsMdBlockRemoved) console.log(`  ${ok("stripped Beacon block from ~/.codex/AGENTS.md")}`);
if (c.mcpRemoved) console.log(`  ${ok("stripped [mcp_servers.beacon] from ~/.codex/config.toml")}`);
if (c.mcpSkipped)
  console.log(`  ${warn("left [mcp_servers.beacon] in ~/.codex/config.toml — it wasn't written by Beacon (remove with: codex mcp remove beacon)")}`);

// Per-repo.
for (const w of workspaces) {
  if (!existsSync(w.path)) continue;
  const r = removeRepoAssets(w.path);
  const bits: string[] = [];
  if (r.skillsRemoved.length) bits.push(`skills(${r.skillsRemoved.length})`);
  if (r.mcpUnregistered) bits.push(".mcp.json");
  if (r.agentsBlockRemoved) bits.push("AGENTS.md");
  if (r.claudeImportRemoved) bits.push("CLAUDE.md");
  if (bits.length) console.log(`  ${ok(`${w.path} → ${bits.join(", ")}`)}`);
}

// Finally: stop the daemon (if running) and wipe ~/.beacon/.
const serverFile = join(home, "server.json");
try {
  const { pid } = JSON.parse(readFileSync(serverFile, "utf8")) as { pid?: number };
  if (pid) {
    try {
      process.kill(pid);
      console.log(`  ${ok(`stopped daemon (pid ${pid})`)}`);
    } catch {
      /* not alive */
    }
  }
} catch {
  /* no server.json */
}
if (existsSync(home)) {
  rmSync(home, { recursive: true, force: true });
  console.log(`  ${ok(`removed ${home}`)}`);
}

console.log(head("Done."));
console.log(
  `  ${warn("The `beacon` binary on your PATH is still there — run the matching uninstall step from your installer to remove it.")}\n`,
);
