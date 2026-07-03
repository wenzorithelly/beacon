import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  GLOBAL_SKILLS,
  GLOBAL_AGENT_BLOCK,
  ensureHookEntry,
  hasHookEntry,
  removeHookEntry,
  ensureMarkerBlock,
  hasMarkerBlock,
  removeMarkerBlock,
  beaconPluginInstalled,
  findBeaconPluginDir,
  isInstalledPluginPath,
  installedBeaconPlugin,
  installSkillFile,
  isPluginManaged,
  isSkillInstalled,
  removeSkillDir,
  type GlobalSkillName,
  type HookSpec,
} from "@/lib/agent-config";
import type { CodexSetupResult } from "@/lib/codex-install";

// Global Beacon install/audit/remove primitives. Owns the bits that live in the user's
// ~/.claude/ home — not per-repo and not per-workspace. The CLI's first-run + the
// `beacon doctor` / `beacon uninstall` subcommands all call into here, so the
// install/inspect/remove logic lives in one place and uninstall can't fall out of sync
// with install. Node-builtins only (this gets dynamic-imported from bin/beacon.ts and
// must work without the Next runtime).

// Bun's os.homedir() does NOT respect mid-process changes to process.env.HOME, which
// the tests rely on for isolation. Read HOME directly so tests can rebase ~/.claude/
// onto a tmpdir safely.
function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}
const CLAUDE_DIR = () => join(userHome(), ".claude");
const SKILLS_DIR = () => join(CLAUDE_DIR(), "skills");
const SETTINGS_FILE = () => join(CLAUDE_DIR(), "settings.json");
const CLAUDE_MD = () => join(CLAUDE_DIR(), "CLAUDE.md");

const CLAUDE_MD_START = "<!-- beacon:global:start -->";
const CLAUDE_MD_END = "<!-- beacon:global:end -->";

// GLOBAL_SKILLS + the discovery block live in lib/agent-config.ts (shared with
// codex-install without an import cycle — see the note there); re-exported here so
// existing importers (doctor, uninstall, tests) keep one source.
export {
  GLOBAL_SKILLS,
  beaconPluginInstalled,
  findBeaconPluginDir,
  isInstalledPluginPath,
  installedBeaconPlugin,
  isPluginManaged,
  type GlobalSkillName,
};
export const GLOBAL_CLAUDE_MD_BLOCK = GLOBAL_AGENT_BLOCK;

export const GLOBAL_HOOKS = [
  {
    event: "PreToolUse" as const,
    matcher: "Edit|Write|MultiEdit",
    command: "beacon guard",
    description:
      "Gate edits against the active plan's scope contract: in-scope → allow, off-scope → ask the user to authorize. Fail-open when there's no active contract.",
  },
  {
    event: "PostToolUse" as const,
    matcher: "Edit|Write|MultiEdit",
    command: "beacon hook",
    description: "Report file edits to Beacon's active feature so the map stays fresh.",
  },
  {
    event: "PermissionRequest" as const,
    matcher: "ExitPlanMode",
    command: "beacon plan",
    description: "Pipe the agent's plan markdown into Beacon's /plan canvas for review.",
  },
  {
    event: "UserPromptSubmit" as const,
    matcher: "*",
    command: "beacon prompt",
    description:
      "On feature-y prompts in a Beacon-wired repo, remind the agent to run the context→propose→describe loop (no-op otherwise).",
  },
  {
    event: "Stop" as const,
    matcher: "*",
    command: "beacon stop-hook",
    description:
      "When the agent ends a turn asking for plan approval in prose (instead of presenting it), nudge it to present the plan on Beacon's /plan canvas. Bounded by stop_hook_active — at most one nudge.",
  },
];

// ── Skills ──────────────────────────────────────────────────────────────────

export function installGlobalSkill(name: string, body: string): string {
  return installSkillFile(SKILLS_DIR(), name, body);
}

export function isGlobalSkillInstalled(name: string): boolean {
  return isSkillInstalled(SKILLS_DIR(), name);
}

export function removeGlobalSkill(name: string): boolean {
  return removeSkillDir(SKILLS_DIR(), name);
}

// ── Hooks (~/.claude/settings.json) ─────────────────────────────────────────

export type { HookSpec };

/** Returns true if the hook was added; false if it was already present (no-op). */
export function ensureGlobalHook(spec: HookSpec): boolean {
  return ensureHookEntry(SETTINGS_FILE(), spec);
}

export function hasGlobalHook(spec: Pick<HookSpec, "event" | "command">): boolean {
  return hasHookEntry(SETTINGS_FILE(), spec);
}

/** Removes hook entries whose command matches. Returns true if anything was removed. */
export function removeGlobalHook(spec: Pick<HookSpec, "event" | "command">): boolean {
  return removeHookEntry(SETTINGS_FILE(), spec);
}

// ── CLAUDE.md global block ──────────────────────────────────────────────────

export function ensureGlobalClaudeMdBlock(body: string): void {
  ensureMarkerBlock(CLAUDE_MD(), CLAUDE_MD_START, CLAUDE_MD_END, body);
}

export function hasGlobalClaudeMdBlock(): boolean {
  return hasMarkerBlock(CLAUDE_MD(), CLAUDE_MD_START);
}

export function removeGlobalClaudeMdBlock(): boolean {
  return removeMarkerBlock(CLAUDE_MD(), CLAUDE_MD_START, CLAUDE_MD_END);
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface GlobalAudit {
  homeExists: boolean;
  skills: Record<string, boolean>;
  hooks: Record<string, boolean>;
  claudeMdBlock: boolean;
}

export function auditGlobal(): GlobalAudit {
  const skills: Record<string, boolean> = {};
  for (const s of GLOBAL_SKILLS) skills[s] = isGlobalSkillInstalled(s);
  const hooks: Record<string, boolean> = {};
  for (const h of GLOBAL_HOOKS) hooks[h.event] = hasGlobalHook({ event: h.event, command: h.command });
  return {
    homeExists: existsSync(CLAUDE_DIR()),
    skills,
    hooks,
    claudeMdBlock: hasGlobalClaudeMdBlock(),
  };
}

// ── Bulk setup (used on every `beacon` run; idempotent) ─────────────────────

export interface SetupResult {
  skillsAdded: string[];
  hooksAdded: number;
  claudeMdBlockTouched: boolean;
}

/**
 * Install every global Beacon asset (skills, settings.json hooks, CLAUDE.md block).
 * Idempotent — safe to call on every `beacon` invocation. Skill bodies come from
 * lib/assets.ts (same content used in the per-repo install) so there's a single source
 * of truth. Returns counts of what actually changed for the CLI to print.
 */
export async function setupGlobalAssets(): Promise<SetupResult> {
  const { INIT_SKILL, REFRESH_SKILL, PLAN_SKILL, EXPLAIN_SKILL } = await import("@/lib/assets");
  const skillBodies: Record<GlobalSkillName, string> = {
    "beacon-init": INIT_SKILL,
    "beacon-refresh": REFRESH_SKILL,
    "beacon-plan": PLAN_SKILL,
    "beacon-explain": EXPLAIN_SKILL,
  };
  const skillsAdded: string[] = [];
  for (const name of GLOBAL_SKILLS) {
    if (!isGlobalSkillInstalled(name)) skillsAdded.push(name);
    installGlobalSkill(name, skillBodies[name]);
  }
  let hooksAdded = 0;
  for (const h of GLOBAL_HOOKS)
    if (ensureGlobalHook({ event: h.event, matcher: h.matcher, command: h.command })) hooksAdded++;
  const blockPresent = hasGlobalClaudeMdBlock();
  ensureGlobalClaudeMdBlock(GLOBAL_CLAUDE_MD_BLOCK);
  return { skillsAdded, hooksAdded, claudeMdBlockTouched: !blockPresent };
}

// ── Self-heal (called from every `beacon` entry point) ─────────────────────

export interface CodexHealResult extends CodexSetupResult {
  ok: boolean;
  error?: string;
}

export interface SelfHealResult extends SetupResult {
  ok: boolean;
  error?: string;
  /**
   * Why the Claude-side global self-heal was skipped, if it was:
   * - "plugin": running AS the installed plugin (CLAUDE_PLUGIN_ROOT set).
   * - "plugin-present": running as the npm CLI but a Beacon plugin is installed, so the npm layer
   *   stepped aside (and removed any stale ~/.claude entries) to avoid double-registering hooks.
   */
  skipped?: "plugin" | "plugin-present";
  /** Present only when the Codex CLI is detected (or BEACON_CODEX=1 forces it). */
  codex?: CodexHealResult;
}

/**
 * Re-apply every global Beacon asset, swallowing errors so a bad ~/.claude
 * never breaks the actual subcommand. Safe to call from `beacon mcp` (must not
 * write to stdout — stdout is the MCP protocol channel; this only writes to
 * disk), from the PostToolUse/PermissionRequest hook entry points, and from
 * `beacon setup`. Idempotent: a second call returns zero counts.
 *
 * The first time a user runs `beacon` anywhere this populates ~/.claude. From
 * then on, every agent session that spawns `beacon mcp` (Claude Code via
 * .mcp.json, Codex via ~/.codex/config.toml) re-applies the global layer, so
 * accidental cleanups + machine migrations heal automatically without the
 * user having to re-run `beacon` in each repo.
 *
 * When the Codex CLI is on the machine, the same heal also wires ~/.codex +
 * ~/.agents (hooks.json, config.toml MCP entry, AGENTS.md block, skills) — and
 * a Codex-side failure never breaks the Claude-side heal (and vice versa).
 */
export async function selfHealGlobal(): Promise<SelfHealResult> {
  // Running as an installed Claude Code plugin: the plugin already ships the skills, hooks, and
  // MCP, so re-applying them into ~/.claude (and ~/.codex) would double-register every hook — the
  // plugin's entry AND a self-healed settings.json entry would both fire. Skip the whole heal.
  if (isPluginManaged()) {
    return { ok: true, skipped: "plugin", skillsAdded: [], hooksAdded: 0, claudeMdBlockTouched: false };
  }
  let result: SelfHealResult;
  if (beaconPluginInstalled()) {
    // npm CLI, but a Beacon Claude Code plugin is installed → it owns the Claude-side skills/hooks/MCP.
    // REMOVE any npm-self-healed Claude entries so hooks don't double-fire, and don't re-add them.
    // Self-correcting: if the plugin is later uninstalled, the next run heals ~/.claude again. (Codex
    // is still wired below — the plugin is Claude Code only.)
    try {
      removeBeaconArtifacts();
    } catch {
      /* best effort — never break the subcommand over a cleanup */
    }
    result = { ok: true, skipped: "plugin-present", skillsAdded: [], hooksAdded: 0, claudeMdBlockTouched: false };
  } else {
    try {
      const r = await setupGlobalAssets();
      result = { ok: true, ...r };
    } catch (e) {
      result = {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        skillsAdded: [],
        hooksAdded: 0,
        claudeMdBlockTouched: false,
      };
    }
  }
  try {
    const codex = await import("@/lib/codex-install");
    if (codex.codexDetected()) result.codex = { ok: true, ...(await codex.setupCodexAssets()) };
  } catch (e) {
    result.codex = {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      skillsAdded: [],
      hooksAdded: 0,
      agentsMdBlockTouched: false,
      mcp: { added: false },
    };
  }
  return result;
}

// ── Bulk remove (used by `beacon uninstall`) ────────────────────────────────

export interface RemoveResult {
  skillsRemoved: string[];
  hooksRemoved: number;
  claudeMdBlockRemoved: boolean;
}

export function removeBeaconArtifacts(): RemoveResult {
  const skillsRemoved: string[] = [];
  for (const s of GLOBAL_SKILLS) if (removeGlobalSkill(s)) skillsRemoved.push(s);
  let hooksRemoved = 0;
  for (const h of GLOBAL_HOOKS) if (removeGlobalHook(h)) hooksRemoved++;
  const claudeMdBlockRemoved = removeGlobalClaudeMdBlock();
  return { skillsRemoved, hooksRemoved, claudeMdBlockRemoved };
}
