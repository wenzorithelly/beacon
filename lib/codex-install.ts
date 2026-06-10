import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ensureHookEntry,
  hasHookEntry,
  removeHookEntry,
  ensureMarkerBlock,
  hasMarkerBlock,
  removeMarkerBlock,
  installSkillFile,
  isSkillInstalled,
  removeSkillDir,
} from "@/lib/agent-config";
import { writeFileAtomic } from "@/lib/atomic-write";
import { GLOBAL_SKILLS, GLOBAL_CLAUDE_MD_BLOCK, type GlobalSkillName } from "@/lib/global-install";

// Codex CLI install/audit/remove primitives — the ~/.codex + ~/.agents twin of
// lib/global-install.ts. Codex reads MCP servers from ~/.codex/config.toml,
// hooks from ~/.codex/hooks.json (same JSON shape as Claude's settings.json),
// global instructions from ~/.codex/AGENTS.md, and skills (same SKILL.md
// format) from ~/.agents/skills. One hard difference: Codex has no
// ExitPlanMode, so there is NO PermissionRequest plan bridge here — plan
// review flows through the beacon_present_plan / beacon_propose_plan MCP
// tools, steered by the AGENTS.md block + the Stop-hook nudge.

function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}
const CODEX_DIR = () => join(userHome(), ".codex");
const CODEX_HOOKS_FILE = () => join(CODEX_DIR(), "hooks.json");
const CODEX_CONFIG_TOML = () => join(CODEX_DIR(), "config.toml");
const CODEX_AGENTS_MD = () => join(CODEX_DIR(), "AGENTS.md");
const AGENTS_SKILLS_DIR = () => join(userHome(), ".agents", "skills");

// Same markers as the ~/.claude/CLAUDE.md block so audit/remove logic rhymes.
const AGENTS_MD_START = "<!-- beacon:global:start -->";
const AGENTS_MD_END = "<!-- beacon:global:end -->";

export const CODEX_HOOKS = [
  {
    event: "PostToolUse" as const,
    // Codex file edits flow through the apply_patch tool (not Edit/Write).
    matcher: "apply_patch",
    command: "beacon hook",
    description: "Report file edits to Beacon's active feature so the map stays fresh.",
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
      "When the agent ends a turn asking for plan approval in prose, nudge it to present the plan on Beacon's /plan canvas.",
  },
];

// ── Detection ───────────────────────────────────────────────────────────────

let whichCache: boolean | undefined;

/**
 * Is the Codex CLI on this machine? BEACON_CODEX=1/0 force-overrides (tests +
 * user opt-out); otherwise a memoized synchronous PATH scan — this runs inside
 * selfHealGlobal() on every hook fire, so it must stay microseconds (no spawn).
 */
export function codexDetected(): boolean {
  if (process.env.BEACON_CODEX === "1") return true;
  if (process.env.BEACON_CODEX === "0") return false;
  if (whichCache === undefined) whichCache = Bun.which("codex") !== null;
  return whichCache;
}

// ── MCP entry in ~/.codex/config.toml ───────────────────────────────────────
//
// Bun can parse TOML but not write it, and rewriting the user's file would
// destroy comments/formatting anyway. Strategy: parse-check for an existing
// entry, else append a marker-delimited table at EOF (always syntactically
// valid TOML) and VALIDATE the candidate parses before writing. On any doubt,
// write nothing and surface the manual one-liner for `beacon doctor`.

const TOML_START = "# beacon:start (managed by Beacon — `beacon uninstall` removes this block)";
const TOML_END = "# beacon:end";
const TOML_BLOCK = `${TOML_START}\n[mcp_servers.beacon]\ncommand = "beacon"\nargs = ["mcp"]\n${TOML_END}\n`;
const MANUAL_FIX = "add it manually: codex mcp add beacon -- beacon mcp";

type TomlConfig = { mcp_servers?: { beacon?: { command?: string } } };

function parseToml(content: string): TomlConfig | null {
  try {
    return Bun.TOML.parse(content) as TomlConfig;
  } catch {
    return null;
  }
}

export function hasCodexMcp(): boolean {
  try {
    return Boolean(parseToml(readFileSync(CODEX_CONFIG_TOML(), "utf8"))?.mcp_servers?.beacon);
  } catch {
    return false;
  }
}

export interface CodexMcpResult {
  added: boolean;
  error?: string;
}

export function ensureCodexMcp(): CodexMcpResult {
  let content = "";
  let exists = false;
  try {
    content = readFileSync(CODEX_CONFIG_TOML(), "utf8");
    exists = true;
  } catch {
    /* no config yet */
  }
  if (exists) {
    const parsed = parseToml(content);
    if (!parsed)
      return { added: false, error: `~/.codex/config.toml does not parse — ${MANUAL_FIX}` };
    if (parsed.mcp_servers?.beacon) return { added: false };
    // An inline `mcp_servers = {...}` assignment makes a later [mcp_servers.beacon]
    // header a TOML redefinition error in Codex's strict parser. Bun.TOML merges it
    // silently, so the candidate-validation below can't catch this — guard on the text.
    if (/^\s*mcp_servers\s*=/m.test(content))
      return { added: false, error: `mcp_servers is an inline table — ${MANUAL_FIX}` };
  }
  const sep = !content ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  const candidate = content + sep + TOML_BLOCK;
  const check = parseToml(candidate);
  if (check?.mcp_servers?.beacon?.command !== "beacon")
    return { added: false, error: `could not safely append [mcp_servers.beacon] — ${MANUAL_FIX}` };
  writeFileAtomic(CODEX_CONFIG_TOML(), candidate);
  return { added: true };
}

export interface CodexMcpRemoveResult {
  removed: boolean;
  /** A beacon entry exists but outside our markers (user-owned) — left in place. */
  skipped?: boolean;
}

export function removeCodexMcp(): CodexMcpRemoveResult {
  let content = "";
  try {
    content = readFileSync(CODEX_CONFIG_TOML(), "utf8");
  } catch {
    return { removed: false };
  }
  const lines = content.split("\n");
  const startIdx = lines.indexOf(TOML_START);
  if (startIdx === -1) return { removed: false, skipped: hasCodexMcp() };
  const endIdx = lines.indexOf(TOML_END, startIdx);
  if (endIdx === -1) return { removed: false, skipped: true };
  lines.splice(startIdx, endIdx - startIdx + 1);
  const remainder = lines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  if (parseToml(remainder) === null) return { removed: false, skipped: true };
  writeFileAtomic(CODEX_CONFIG_TOML(), remainder);
  return { removed: true };
}

// ── Bulk setup (mirrors setupGlobalAssets; idempotent) ──────────────────────

export interface CodexSetupResult {
  skillsAdded: string[];
  hooksAdded: number;
  agentsMdBlockTouched: boolean;
  mcp: CodexMcpResult;
}

export async function setupCodexAssets(): Promise<CodexSetupResult> {
  const { INIT_SKILL, REFRESH_SKILL, PLAN_SKILL } = await import("@/lib/assets");
  const skillBodies: Record<GlobalSkillName, string> = {
    "beacon-init": INIT_SKILL,
    "beacon-refresh": REFRESH_SKILL,
    "beacon-plan": PLAN_SKILL,
  };
  const skillsAdded: string[] = [];
  for (const name of GLOBAL_SKILLS) {
    if (!isSkillInstalled(AGENTS_SKILLS_DIR(), name)) skillsAdded.push(name);
    installSkillFile(AGENTS_SKILLS_DIR(), name, skillBodies[name]);
  }
  let hooksAdded = 0;
  for (const h of CODEX_HOOKS)
    if (ensureHookEntry(CODEX_HOOKS_FILE(), { event: h.event, matcher: h.matcher, command: h.command }))
      hooksAdded++;
  const blockPresent = hasMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START);
  ensureMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START, AGENTS_MD_END, GLOBAL_CLAUDE_MD_BLOCK);
  const mcp = ensureCodexMcp();
  return { skillsAdded, hooksAdded, agentsMdBlockTouched: !blockPresent, mcp };
}

// ── Audit ───────────────────────────────────────────────────────────────────

export interface CodexAudit {
  detected: boolean;
  skills: Record<string, boolean>;
  hooks: Record<string, boolean>;
  agentsMdBlock: boolean;
  mcp: boolean;
}

export function auditCodex(): CodexAudit {
  const skills: Record<string, boolean> = {};
  for (const s of GLOBAL_SKILLS) skills[s] = isSkillInstalled(AGENTS_SKILLS_DIR(), s);
  const hooks: Record<string, boolean> = {};
  for (const h of CODEX_HOOKS)
    hooks[h.event] = hasHookEntry(CODEX_HOOKS_FILE(), { event: h.event, command: h.command });
  return {
    detected: codexDetected(),
    skills,
    hooks,
    agentsMdBlock: hasMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START),
    mcp: hasCodexMcp(),
  };
}

// ── Bulk remove (used by `beacon uninstall`) ────────────────────────────────

export interface CodexRemoveResult {
  skillsRemoved: string[];
  hooksRemoved: number;
  agentsMdBlockRemoved: boolean;
  mcpRemoved: boolean;
  mcpSkipped?: boolean;
}

export function removeCodexArtifacts(): CodexRemoveResult {
  const skillsRemoved: string[] = [];
  for (const s of GLOBAL_SKILLS) if (removeSkillDir(AGENTS_SKILLS_DIR(), s)) skillsRemoved.push(s);
  let hooksRemoved = 0;
  for (const h of CODEX_HOOKS)
    if (removeHookEntry(CODEX_HOOKS_FILE(), { event: h.event, command: h.command })) hooksRemoved++;
  const agentsMdBlockRemoved = removeMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START, AGENTS_MD_END);
  const mcp = removeCodexMcp();
  return {
    skillsRemoved,
    hooksRemoved,
    agentsMdBlockRemoved,
    mcpRemoved: mcp.removed,
    mcpSkipped: mcp.skipped,
  };
}
