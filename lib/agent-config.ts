import {
  existsSync,
  mkdirSync,
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
