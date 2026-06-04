import { spawn, spawnSync } from "node:child_process";
import { platform } from "node:os";

// Server-side: detect the user's editor and open files in it via its CLI (the
// reliable cross-editor approach — Cursor/VS Code/etc. all ship a `cli <file>`).

export type EditorId = "cursor" | "vscode" | "windsurf" | "zed";

export const EDITORS: Record<
  EditorId,
  { label: string; cli: string; goto: (abs: string) => string[]; app: string }
> = {
  cursor: { label: "Cursor", cli: "cursor", goto: (a) => [a], app: "Cursor" },
  vscode: { label: "VS Code", cli: "code", goto: (a) => ["-g", a], app: "Visual Studio Code" },
  windsurf: { label: "Windsurf", cli: "windsurf", goto: (a) => [a], app: "Windsurf" },
  zed: { label: "Zed", cli: "zed", goto: (a) => [a], app: "Zed" },
};

function which(cmd: string): boolean {
  try {
    return spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

export function detectEditor(): EditorId {
  const hints = [
    process.env.GIT_EDITOR,
    process.env.VISUAL,
    process.env.EDITOR,
    process.env.TERM_PROGRAM,
    process.env.__CFBundleIdentifier,
  ]
    .join(" ")
    .toLowerCase();
  if (/cursor/.test(hints)) return "cursor";
  if (/windsurf/.test(hints)) return "windsurf";
  if (/\bzed\b/.test(hints)) return "zed";
  if (/vscode|visual studio code/.test(hints)) return "vscode";
  for (const id of ["cursor", "vscode", "windsurf", "zed"] as EditorId[]) {
    if (which(EDITORS[id].cli)) return id;
  }
  return "vscode";
}

export function resolveEditor(setting: string | undefined): EditorId {
  if (setting && setting !== "auto" && setting in EDITORS) return setting as EditorId;
  return detectEditor();
}

/** Open an absolute file path in the resolved editor. Returns false if nothing worked. */
export function openInEditor(absPath: string, editorId: EditorId): boolean {
  const ed = EDITORS[editorId];
  if (which(ed.cli)) {
    spawn(ed.cli, ed.goto(absPath), { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  if (platform() === "darwin") {
    spawn("open", ["-a", ed.app, absPath], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  return false;
}
