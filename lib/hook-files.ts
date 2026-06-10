import { resolve } from "node:path";

// Pure extraction of edited-file paths from a PostToolUse hook event, shared by
// Claude Code and Codex sessions (bin/hook.ts pipes both here).
//
// Claude Code edit tools (Edit/Write/MultiEdit) carry absolute paths in
// tool_input.file_path / .path / .files[].file_path. Codex edits flow through
// the apply_patch tool instead: the patch envelope lives in a string field of
// tool_input (the exact field name is not contractual, so we scan string
// values for the envelope) and lists cwd-relative paths on
// `*** Update File:` / `*** Add File:` / `*** Move to:` lines.

interface ToolEvent {
  tool_name?: string;
  tool_input?: unknown;
  cwd?: string;
}

const PATCH_ENVELOPE = "*** Begin Patch";
const PATCH_LINE = /^\*\*\* (Update File|Add File|Move to): (.+)$/;

function filesFromPatch(patch: string): string[] {
  const files: string[] = [];
  for (const line of patch.split("\n")) {
    const m = PATCH_LINE.exec(line.trim());
    if (!m) continue;
    const path = m[2].trim();
    // A rename: `*** Move to:` follows its `*** Update File:` — the old path is
    // gone, report the new one. Deletes are skipped entirely: attaching a
    // just-deleted file to the active feature's map would be wrong.
    if (m[1] === "Move to") files.pop();
    files.push(path);
  }
  return files;
}

export function filesFromToolEvent(ev: ToolEvent): string[] {
  const ti = ev.tool_input;
  if (ti === null || typeof ti !== "object") return [];
  const t = ti as Record<string, unknown>;

  const files: string[] = [];
  if (typeof t.file_path === "string") files.push(t.file_path);
  if (typeof t.path === "string") files.push(t.path);
  if (Array.isArray(t.files)) {
    for (const f of t.files) {
      const fp = (f as { file_path?: unknown } | null)?.file_path;
      if (typeof fp === "string") files.push(fp);
    }
  }
  if (files.length) return files;

  const cwd = typeof ev.cwd === "string" ? ev.cwd : process.cwd();
  for (const v of Object.values(t)) {
    if (typeof v !== "string" || !v.includes(PATCH_ENVELOPE)) continue;
    return filesFromPatch(v).map((p) => resolve(cwd, p));
  }
  return [];
}
