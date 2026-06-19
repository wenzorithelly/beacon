import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// Path-parameterized install primitives shared by every agent-CLI surface Beacon
// wires up: ~/.claude (lib/global-install.ts) and ~/.codex + ~/.agents
// (lib/codex-install.ts). Claude Code's settings.json and Codex's hooks.json use
// the SAME hooks shape ({hooks: {Event: [{matcher, hooks: [{type, command}]}]}}),
// so one merge implementation serves both. Node-builtins only — this gets
// dynamic-imported from bin/ entry points and must work without the Next runtime.

export const GLOBAL_SKILLS = ["beacon-init", "beacon-refresh", "beacon-plan", "beacon-explain"] as const;
export type GlobalSkillName = (typeof GLOBAL_SKILLS)[number];

// True when Beacon is running as an installed Claude Code plugin rather than the npm `trybeacon`
// CLI. Claude Code sets CLAUDE_PLUGIN_ROOT in the env whenever it invokes the plugin's own hooks /
// MCP command; bin/beacon.ts ALSO sets it when the running binary lives inside a plugin payload
// (covers the `/beacon` agent-bash path Claude Code doesn't set it for). In plugin mode the plugin
// already ships the skills, hooks, and MCP, so the legacy ~/.claude + per-repo self-heal MUST be
// suppressed — re-writing settings.json would double-register every hook.
export function isPluginManaged(): boolean {
  return !!process.env.CLAUDE_PLUGIN_ROOT;
}

// Locate an installed Beacon Claude Code plugin under ~/.claude/plugins (Claude Code clones a plugin
// to ~/.claude/plugins/<marketplace>/<plugin>). Returns its directory, or null. Scans a few levels
// for a .claude-plugin/plugin.json whose name is "beacon". Used so the npm self-heal can step aside
// when the plugin is present (the plugin owns the agent integration), and by `beacon doctor`.
export function findBeaconPluginDir(home = process.env.HOME || process.env.USERPROFILE || ""): string | null {
  if (!home) return null;
  const base = join(home, ".claude", "plugins");
  if (!existsSync(base)) return null;
  let level = [base];
  for (let depth = 0; depth < 3 && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      const manifest = join(dir, ".claude-plugin", "plugin.json");
      try {
        if (existsSync(manifest) && (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name === "beacon") {
          return dir;
        }
      } catch {
        /* unreadable manifest — keep scanning */
      }
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) next.push(join(dir, e.name));
      } catch {
        /* unreadable dir — skip */
      }
    }
    level = next;
  }
  return null;
}

/** True when a Beacon Claude Code plugin is installed (so the npm self-heal should step aside). */
export function beaconPluginInstalled(home?: string): boolean {
  return findBeaconPluginDir(home) !== null;
}

// True when a path lives INSIDE an installed Claude Code plugin payload (under ~/.claude/plugins/).
// This is NON-OBVIOUS and load-bearing: the published npm package BUNDLES .claude-plugin/plugin.json
// (build:plugin embeds it for marketplace distribution), so "a plugin.json sits next to the binary"
// is true for BOTH a real installed plugin AND a plain `bun add -g trybeacon`. Without this stricter
// check, bin/beacon.ts self-set CLAUDE_PLUGIN_ROOT for every npm-CLI user → isPluginManaged() → the
// whole self-heal (skills/hooks/MCP) was suppressed, so new skills never installed on update.
export function isInstalledPluginPath(p: string): boolean {
  return /[\\/]\.claude[\\/]plugins[\\/]/.test(p);
}

// The installed Beacon Claude Code plugin as "name@marketplace" + its marketplace, or null — read
// from the plugins manifest so `beacon update` can also bump the plugin (claude plugin update).
// Detection needs no `claude` CLI; only the actual update call does.
export function installedBeaconPlugin(
  home = process.env.HOME || process.env.USERPROFILE || "",
): { key: string; marketplace: string } | null {
  if (!home) return null;
  try {
    const manifest = JSON.parse(
      readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8"),
    ) as { plugins?: Record<string, unknown> };
    for (const key of Object.keys(manifest.plugins ?? {})) {
      if (/^beacon@/.test(key)) return { key, marketplace: key.split("@")[1] ?? "" };
    }
  } catch {
    /* no manifest / not installed */
  }
  return null;
}

// Block injected into ~/.claude/CLAUDE.md AND ~/.codex/AGENTS.md so EVERY agent session —
// including the ones in repos that have never seen Beacon — knows the tool exists and how
// to wire it. Kept intentionally short: triggers + the one-command fix when something
// isn't wired. Lives here (not in global-install) so codex-install can import it without
// creating a global-install ↔ codex-install cycle — newer Bun bundlers merge cyclic CLI
// entrypoints instead of emitting both, which shipped a broken v0.1.18.
export const GLOBAL_AGENT_BLOCK = `## Beacon (visual planning panel)

This machine has Beacon installed — a local visual planning surface for the terminal-side
agent. Beacon proposes feature plans (roadmap features + DB schema + endpoints) via MCP,
the user reviews on a canvas at /plan, and feedback flows back as the next round.

**When to invoke**
- User asks to "plan a feature" / "design a schema" → if the \`beacon_propose_plan\`
  MCP tool is available, design the plan and call it. If it is NOT available, the panel
  isn't wired in this repo — run \`beacon\` here once, then retry.
- User asks to "set up Beacon" / "map this repo" → invoke the \`beacon-init\` skill.
- User asks to "refresh Beacon" / "update the map" / "bring Beacon up to date" → invoke
  the \`beacon-refresh\` skill. Re-surveys the repo and updates init-derived nodes while
  preserving anything the user added by hand.
- User asks to "explain" / "teach me" / "walk me through" / "how does X work" → if the
  \`beacon_explain\` MCP tool is available, author an interactive Lesson (a concept map +
  plain-English narrative on /learn the user questions back) via the \`beacon-explain\` skill.
- Run \`beacon doctor\` to audit what's wired (global hooks, repo's .mcp.json, AGENTS.md block).

**The plan feedback loop**
\`beacon_propose_plan\` BLOCKS until the user clicks Approve / Discard / submits feedback.
Feedback bundles inline annotations on the markdown PLUS any edits the user made directly
on the /map and /db boards (added features, attached subtasks, edited columns, new
endpoints). Treat board edits as the user's revision intent — re-propose matching them
verbatim. Do NOT implement until the tool returns approval.`;

export type HookCommand = { type: "command"; command: string };
export type HookMatcher = { matcher: string; hooks: HookCommand[] };
export interface HooksDoc {
  hooks?: Partial<Record<string, HookMatcher[]>>;
  [k: string]: unknown;
}

export interface HookSpec {
  event: string;
  matcher: string;
  command: string;
}

function readHooksDoc(file: string): HooksDoc {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HooksDoc;
  } catch {
    return {};
  }
}

function writeHooksDoc(file: string, doc: HooksDoc): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
}

// ── Hook entries (settings.json / hooks.json) ───────────────────────────────

/** Returns true if the hook was added; false if it was already present (no-op). */
export function ensureHookEntry(file: string, spec: HookSpec): boolean {
  const doc = readHooksDoc(file);
  doc.hooks = doc.hooks ?? {};
  doc.hooks[spec.event] = doc.hooks[spec.event] ?? [];
  const arr = doc.hooks[spec.event]!;
  const already = arr.some(
    (m) => m.matcher === spec.matcher && m.hooks?.some((h) => h.command === spec.command),
  );
  if (already) return false;
  arr.push({ matcher: spec.matcher, hooks: [{ type: "command", command: spec.command }] });
  writeHooksDoc(file, doc);
  return true;
}

export function hasHookEntry(file: string, spec: Pick<HookSpec, "event" | "command">): boolean {
  const doc = readHooksDoc(file);
  const arr = doc.hooks?.[spec.event] ?? [];
  return arr.some((m) => m.hooks?.some((h) => h.command === spec.command));
}

/** Removes hook entries whose command matches. Returns true if anything was removed. */
export function removeHookEntry(
  file: string,
  spec: Pick<HookSpec, "event" | "command">,
): boolean {
  const doc = readHooksDoc(file);
  const arr = doc.hooks?.[spec.event];
  if (!arr) return false;
  let changed = false;
  const filtered = arr
    .map((m) => {
      const before = m.hooks?.length ?? 0;
      const after = (m.hooks ?? []).filter((h) => h.command !== spec.command);
      if (after.length !== before) changed = true;
      return { ...m, hooks: after };
    })
    .filter((m) => (m.hooks ?? []).length > 0);
  if (!changed) return false;
  if (filtered.length) doc.hooks![spec.event] = filtered;
  else delete doc.hooks![spec.event];
  if (doc.hooks && Object.keys(doc.hooks).length === 0) delete doc.hooks;
  writeHooksDoc(file, doc);
  return true;
}

// ── Marker-delimited blocks (CLAUDE.md / AGENTS.md) ─────────────────────────

export function ensureMarkerBlock(
  file: string,
  start: string,
  end: string,
  body: string,
): void {
  const block = `${start}\n${body.trim()}\n${end}`;
  let md = "";
  try {
    md = readFileSync(file, "utf8");
  } catch {
    /* new file */
  }
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  md = re.test(md)
    ? md.replace(re, block)
    : md.trim()
      ? `${md.trim()}\n\n${block}\n`
      : `${block}\n`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, md.endsWith("\n") ? md : `${md}\n`);
}

export function hasMarkerBlock(file: string, start: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(start);
  } catch {
    return false;
  }
}

export function removeMarkerBlock(file: string, start: string, end: string): boolean {
  let md = "";
  try {
    md = readFileSync(file, "utf8");
  } catch {
    return false;
  }
  const re = new RegExp(`${start}[\\s\\S]*?${end}\\n?`);
  if (!re.test(md)) return false;
  const out = md.replace(re, "").replace(/\n{3,}/g, "\n\n").trimStart();
  writeFileSync(file, out);
  return true;
}

// ── Skill files (<skillsDir>/<name>/SKILL.md) ───────────────────────────────

export function installSkillFile(skillsDir: string, name: string, body: string): string {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, body);
  return path;
}

export function isSkillInstalled(skillsDir: string, name: string): boolean {
  return existsSync(join(skillsDir, name, "SKILL.md"));
}

export function removeSkillDir(skillsDir: string, name: string): boolean {
  const dir = join(skillsDir, name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}
