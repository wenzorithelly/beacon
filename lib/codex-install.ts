import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import {
  GLOBAL_SKILLS,
  GLOBAL_AGENT_BLOCK,
  beaconCliCommand,
  ensureHookEntry,
  dedupeHookEntry,
  hasHookEntry,
  removeHookEntry,
  ensureMarkerBlock,
  hasMarkerBlock,
  removeMarkerBlock,
  installSkillFile,
  isSkillInstalled,
  removeSkillDir,
  repointBeaconCommand,
  type GlobalSkillName,
} from "@/lib/agent-config";
import { writeFileAtomic } from "@/lib/atomic-write";

// Codex CLI install/audit/remove primitives — the ~/.codex + ~/.agents twin of
// lib/global-install.ts. Codex reads MCP servers from ~/.codex/config.toml,
// hooks from ~/.codex/hooks.json (same JSON shape as Claude's settings.json),
// global instructions from ~/.codex/AGENTS.md, and skills (same SKILL.md
// format) from ~/.agents/skills. One hard difference: Codex has no
// ExitPlanMode, so there is NO PermissionRequest plan bridge here — plan
// review flows through the beacon_present_plan / beacon_propose_plan MCP
// tools, steered by the AGENTS.md block.

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
];

const LEGACY_STOP_HOOK = { event: "Stop" as const, command: "beacon stop-hook" };

// ── Detection ───────────────────────────────────────────────────────────────

let whichCache: boolean | undefined;

/**
 * Node fallback for `Bun.which` — scan PATH for an executable named `name`. Pure + injectable so it
 * unit-tests without Bun: pass an explicit PATH string and an executability predicate. Returns the
 * resolved absolute path, or null. (The compiled CLI bundle runs under plain Node inside the desktop
 * app, where `Bun` is undefined; an uncaught `Bun.which` there throws.)
 */
export function nodeWhich(
  name: string,
  pathValue: string = process.env.PATH || "",
  isExecutable: (p: string) => boolean = defaultIsExecutable,
): string | null {
  if (!name) return null;
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function defaultIsExecutable(p: string): boolean {
  try {
    accessSync(p, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Is `name` an executable on PATH? Uses Bun.which when Bun is the runtime, else the Node fallback. */
export function commandExists(name: string): boolean {
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") return Bun.which(name) !== null;
  return nodeWhich(name) !== null;
}

/**
 * Is the Codex CLI on this machine? BEACON_CODEX=1/0 force-overrides (tests +
 * user opt-out); otherwise a memoized synchronous PATH scan — this runs inside
 * selfHealGlobal() on every hook fire, so it must stay microseconds (no spawn).
 * Runtime-agnostic: Bun.which under Bun, a Node PATH scan under plain Node.
 */
export function codexDetected(): boolean {
  if (process.env.BEACON_CODEX === "1") return true;
  if (process.env.BEACON_CODEX === "0") return false;
  if (whichCache === undefined) whichCache = commandExists("codex");
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
// The command points at the resolved `beacon` CLI (bare `beacon` by default; the app-embedded shim
// when Beacon.app is installed) — built at write time so a fresh install lands on the right binary.
const tomlBlock = () =>
  `${TOML_START}\n[mcp_servers.beacon]\ncommand = "${beaconCliCommand()}"\nargs = ["mcp"]\n${TOML_END}\n`;
const MANUAL_FIX = "add it manually: codex mcp add beacon -- beacon mcp";

type TomlConfig = { mcp_servers?: { beacon?: { command?: string } } };

/**
 * Minimal, targeted TOML reader for the Node runtime (no Bun.TOML). The Codex path only ever asks
 * two things of a parse: is there an `[mcp_servers.beacon]` entry, and what is its `command`? This
 * scans for exactly that — the canonical table shape Beacon writes and reads back. It intentionally
 * does NOT validate arbitrary TOML (a full parser isn't warranted for two keys, and we add no TOML
 * dependency): under Node the "does not parse" / inline-table guards that need a real parser degrade
 * gracefully — the text-based `/^\s*mcp_servers\s*=/m` guard in ensureCodexMcp still fires, and we
 * only ever APPEND our own always-valid marker block, never rewrite the user's bytes.
 */
export function parseTomlBeacon(content: string): TomlConfig {
  const config: TomlConfig = {};
  let inBeaconTable = false;
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      inBeaconTable = header[1].trim() === "mcp_servers.beacon";
      if (inBeaconTable) {
        config.mcp_servers = config.mcp_servers ?? {};
        config.mcp_servers.beacon = config.mcp_servers.beacon ?? {};
      }
      continue;
    }
    if (inBeaconTable) {
      const cmd = /^command\s*=\s*["']([^"']*)["']/.exec(line);
      if (cmd) config.mcp_servers!.beacon!.command = cmd[1];
    }
  }
  return config;
}

function parseToml(content: string): TomlConfig | null {
  try {
    if (typeof Bun !== "undefined" && Bun.TOML?.parse) return Bun.TOML.parse(content) as TomlConfig;
    return parseTomlBeacon(content);
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

/**
 * Read-only diagnosis for `beacon doctor`: why is the MCP entry missing/unfixable?
 * null when there's no problem a bare `beacon` run wouldn't fix.
 */
export function codexMcpProblem(): string | null {
  let content = "";
  try {
    content = readFileSync(CODEX_CONFIG_TOML(), "utf8");
  } catch {
    return null; // no config yet — ensureCodexMcp will create it
  }
  const parsed = parseToml(content);
  if (!parsed) return `~/.codex/config.toml does not parse — ${MANUAL_FIX}`;
  if (parsed.mcp_servers?.beacon) return null;
  if (/^\s*mcp_servers\s*=/m.test(content))
    return `mcp_servers is an inline table — ${MANUAL_FIX}`;
  return null;
}

function repointManagedCodexMcp(content: string): string | null {
  const lines = content.split("\n");
  const startIdx = lines.indexOf(TOML_START);
  const endIdx = lines.indexOf(TOML_END, startIdx);
  if (startIdx === -1 || endIdx === -1) return null;
  const beaconIdx = lines.findIndex(
    (line, index) => index > startIdx && index < endIdx && line.trim() === "[mcp_servers.beacon]",
  );
  if (beaconIdx === -1) return null;
  let tableEnd = beaconIdx + 1;
  while (tableEnd < endIdx && !/^\s*\[/.test(lines[tableEnd]!)) tableEnd++;
  const commandIdx = lines.findIndex(
    (line, index) => index > beaconIdx && index < tableEnd && /^\s*command\s*=/.test(line),
  );
  if (commandIdx === -1) return null;
  lines[commandIdx] = `command = ${JSON.stringify(beaconCliCommand())}`;
  return lines.join("\n");
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
    if (parsed.mcp_servers?.beacon) {
      const repointed = repointManagedCodexMcp(content);
      if (repointed && repointed !== content) writeFileAtomic(CODEX_CONFIG_TOML(), repointed);
      return { added: false };
    }
    // An inline `mcp_servers = {...}` assignment makes a later [mcp_servers.beacon]
    // header a TOML redefinition error in Codex's strict parser. Bun.TOML merges it
    // silently, so the candidate-validation below can't catch this — guard on the text.
    if (/^\s*mcp_servers\s*=/m.test(content))
      return { added: false, error: `mcp_servers is an inline table — ${MANUAL_FIX}` };
  }
  const sep = !content ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  const candidate = content + sep + tomlBlock();
  const check = parseToml(candidate);
  if (check?.mcp_servers?.beacon?.command !== beaconCliCommand())
    return { added: false, error: `could not safely append [mcp_servers.beacon] — ${MANUAL_FIX}` };
  writeFileAtomic(CODEX_CONFIG_TOML(), candidate);
  return { added: true };
}

/** The `beacon` binary the config.toml MCP entry points at (its `command`), or null. For `beacon doctor`. */
export function codexMcpCliTarget(): string | null {
  try {
    return parseToml(readFileSync(CODEX_CONFIG_TOML(), "utf8"))?.mcp_servers?.beacon?.command ?? null;
  } catch {
    return null;
  }
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
  const beaconIdx = lines.findIndex(
    (line, index) => index > startIdx && index < endIdx && line.trim() === "[mcp_servers.beacon]",
  );
  if (beaconIdx === -1) return { removed: false, skipped: true };

  // Codex Desktop may append another MCP table before our closing marker. Remove
  // only Beacon's table and the marker comments; every foreign line survives.
  let beaconEnd = beaconIdx + 1;
  while (beaconEnd < endIdx && !/^\s*\[/.test(lines[beaconEnd]!)) beaconEnd++;
  lines.splice(beaconIdx, beaconEnd - beaconIdx);
  lines.splice(lines.indexOf(TOML_END), 1);
  lines.splice(lines.indexOf(TOML_START), 1);
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
  const { INIT_SKILL, REFRESH_SKILL, PLAN_SKILL, EXPLAIN_SKILL } = await import("@/lib/assets");
  const skillBodies: Record<GlobalSkillName, string> = {
    "beacon-init": INIT_SKILL,
    "beacon-refresh": REFRESH_SKILL,
    "beacon-plan": PLAN_SKILL,
    "beacon-explain": EXPLAIN_SKILL,
  };
  const skillsAdded: string[] = [];
  for (const name of GLOBAL_SKILLS) {
    if (!isSkillInstalled(AGENTS_SKILLS_DIR(), name)) skillsAdded.push(name);
    installSkillFile(AGENTS_SKILLS_DIR(), name, skillBodies[name]);
  }
  // Retire Beacon's old turn-ending hook on upgrade, but leave unrelated Stop
  // hooks alone.
  removeHookEntry(CODEX_HOOKS_FILE(), LEGACY_STOP_HOOK);
  let hooksAdded = 0;
  for (const h of CODEX_HOOKS) {
    const matcherIsIgnored = h.event === "UserPromptSubmit";
    if (matcherIsIgnored)
      dedupeHookEntry(CODEX_HOOKS_FILE(), {
        event: h.event,
        matcher: h.matcher,
        command: repointBeaconCommand(h.command),
      });
    if (
      ensureHookEntry(CODEX_HOOKS_FILE(), {
        event: h.event,
        matcher: h.matcher,
        command: repointBeaconCommand(h.command),
      }, { matchAnyMatcher: matcherIsIgnored })
    )
      hooksAdded++;
  }
  const blockPresent = hasMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START);
  ensureMarkerBlock(CODEX_AGENTS_MD(), AGENTS_MD_START, AGENTS_MD_END, GLOBAL_AGENT_BLOCK);
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
  if (removeHookEntry(CODEX_HOOKS_FILE(), LEGACY_STOP_HOOK)) hooksRemoved++;
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
