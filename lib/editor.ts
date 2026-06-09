import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// Server-side: detect the user's editor and open files in it. Preference order is CLI on PATH →
// installed app (even without a CLI shim) → the OS default handler, so SOMETHING always opens
// instead of failing silently. Cross-platform: macOS, Windows, Linux.

export type EditorId = "cursor" | "vscode" | "windsurf" | "zed";

const isWin = platform() === "win32";
const isMac = platform() === "darwin";

export const EDITORS: Record<
  EditorId,
  {
    label: string;
    cli: string;
    goto: (abs: string) => string[];
    /** macOS .app bundle name. */
    app: string;
    /** Windows .exe locations, relative to %LOCALAPPDATA% / %ProgramFiles% / %ProgramFiles(x86)%. */
    winExe: string[];
  }
> = {
  cursor: {
    label: "Cursor",
    cli: "cursor",
    goto: (a) => [a],
    app: "Cursor",
    winExe: ["Programs/cursor/Cursor.exe"],
  },
  vscode: {
    label: "VS Code",
    cli: "code",
    goto: (a) => ["-g", a],
    app: "Visual Studio Code",
    winExe: ["Programs/Microsoft VS Code/Code.exe", "Microsoft VS Code/Code.exe"],
  },
  windsurf: {
    label: "Windsurf",
    cli: "windsurf",
    goto: (a) => [a],
    app: "Windsurf",
    winExe: ["Programs/Windsurf/Windsurf.exe"],
  },
  zed: {
    label: "Zed",
    cli: "zed",
    goto: (a) => [a],
    app: "Zed",
    winExe: ["Zed/Zed.exe"],
  },
};

function which(cmd: string): boolean {
  try {
    // POSIX: `which`; Windows: `where` (run through the shell so the builtin/.exe resolves).
    return spawnSync(isWin ? "where" : "which", [cmd], { stdio: "ignore", shell: isWin }).status === 0;
  } catch {
    return false;
  }
}

// Windows: absolute path to the editor's .exe if installed, else null.
function findWinExe(id: EditorId): string | null {
  const bases = [
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ].filter((b): b is string => !!b);
  for (const rel of EDITORS[id].winExe) {
    for (const base of bases) {
      const p = join(base, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// Is the editor installed as an APP (not just a CLI shim on PATH)? Catches the common case of
// Cursor/VS Code installed but their CLI never added to PATH.
function appInstalled(id: EditorId): boolean {
  if (isMac) {
    const app = EDITORS[id].app;
    return existsSync(join("/Applications", `${app}.app`)) || existsSync(join(homedir(), "Applications", `${app}.app`));
  }
  if (isWin) return findWinExe(id) !== null;
  return false;
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
  const order: EditorId[] = ["cursor", "vscode", "windsurf", "zed"];
  // CLI on PATH?
  for (const id of order) if (which(EDITORS[id].cli)) return id;
  // Installed app even without a CLI shim (macOS .app / Windows .exe)?
  for (const id of order) if (appInstalled(id)) return id;
  return "vscode";
}

export function resolveEditor(setting: string | undefined): EditorId {
  if (setting && setting !== "auto" && setting in EDITORS) return setting as EditorId;
  return detectEditor();
}

/** Open an absolute file path in the resolved editor. Returns false if nothing worked. */
export function openInEditor(absPath: string, editorId: EditorId): boolean {
  const ed = EDITORS[editorId];

  // 1. CLI on PATH (works on every OS; Windows shims are .cmd, so go through the shell there).
  if (which(ed.cli)) {
    spawn(ed.cli, ed.goto(absPath), { detached: true, stdio: "ignore", shell: isWin, windowsHide: true }).unref();
    return true;
  }

  // 2. Installed app, then 3. OS default handler — per platform.
  if (isMac) {
    const args = appInstalled(editorId) ? ["-a", ed.app, absPath] : [absPath];
    spawn("open", args, { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  if (isWin) {
    const exe = findWinExe(editorId);
    if (exe) {
      spawn(exe, ed.goto(absPath), { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else {
      // `start "" "<path>"` hands off to the file's default app. Empty "" is the (required) title.
      spawn("cmd", ["/c", "start", "", absPath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    }
    return true;
  }
  // Linux / other: default handler.
  spawn("xdg-open", [absPath], { detached: true, stdio: "ignore" }).unref();
  return true;
}
