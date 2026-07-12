// Beacon Desktop shell bridge — the open app's HALF of a deliberately tiny, GENERIC contract with
// the desktop shell (the private beacon-desktop repo). History: the shell originally kept this repo
// completely desktop-unaware and scraped the DOM from injected scripts (button-text matching,
// MutationObservers, marker attributes) to mirror /plan's header controls into its chrome bar. That
// produced exactly the bug class you'd expect — races, stale state after navigation, one outright
// UI freeze — so the ruling was relaxed (owner decision, 2026-07-09): the open app may carry
// MINIMAL, explicitly-gated shell awareness, the same pattern every production Electron app
// wrapping its own web code uses (Slack/VS Code/Discord: one shared codebase, environment checks).
//
// The contract is one keyed state channel + one keyed action channel, NOT per-feature channels —
// the /plan header is just the first surface (owner's call: "this won't be just for the plan").
// A future chrome-bar control mirrors a new `key` over the same two messages; the shell's preload
// and IPC relay never change again — only the chrome bar learns to render the new key, and the
// owning component here learns to report it.
//
// Transport: window.postMessage with the shell's `__beaconShell` envelope — the shell's preload
// relays these to/from its chrome bar over IPC. In a plain browser tab nothing here matches or
// fires: isDesktopShell() is false (no preload stamped the attribute) and the shell:hidden
// Tailwind variant (globals.css) never applies.
//
// Client-safe: no node imports, no react — usable from any client component's effect.

/** Keys for shell-mirrored surfaces. Add new surfaces here so both repos share one vocabulary. */
export const SHELL_SURFACE = {
  planHeader: "plan-header",
  learnHeader: "learn-header",
} as const;

/** The /plan header state the shell's chrome bar renders (beacon-desktop chrome.cts). Page-level
 * only, by design: which view toggle is active. Selection-level info (a past plan's verdict badge)
 * deliberately does NOT cross this bridge — it renders in-flow with the plan it describes
 * (plan-history-view.tsx), so there's nothing to keep in sync. */
export interface PlanHeaderState {
  toggle: { active: "history" | "changes" } | null;
}

/** The /learn header state the shell's chrome bar renders (beacon-desktop chrome.cts): which
 * top-level view is showing — the active lesson (learn-workspace.tsx) or the saved-lessons library
 * (lesson-library-view.tsx). Page-level only, same rationale as PlanHeaderState. */
export interface LearnHeaderState {
  toggle: { active: "lesson" | "library" } | null;
}

/** True only inside the Beacon Desktop shell (its preload stamps <html data-shell="desktop"> at
 * document-start, pre-hydration). False on the server and in any plain browser tab. */
export function isDesktopShell(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.shell === "desktop";
}

/** Report a surface's current state to the shell. Send the surface's FULL state every time (the
 * shell replaces its whole copy for that key); send null on unmount so the shell clears it when
 * the user leaves the surface. No-op outside the shell. */
export function reportShellState(key: string, state: unknown): void {
  if (!isDesktopShell()) return;
  try {
    window.postMessage({ __beaconShell: "surface-state", key, state }, window.location.origin);
  } catch {
    /* torn-down window mid-navigation */
  }
}

// ── window.beaconDesktop — the shell preload's contextBridge API (the OTHER seam) ───────────────
// Besides the postMessage envelope above, the shell's sandboxed preload exposes a narrow invoke API
// as `window.beaconDesktop`. The open UI gates every affordance on the SPECIFIC METHOD existing —
// a plain browser tab (no preload → `window.beaconDesktop` undefined) never renders any of it, and
// an older shell without a newer method degrades the same way. Only the members this repo actually
// calls are typed here (every method optional, for exactly that gating); the shell repo's
// terminals/protocol.ts `BeaconDesktopApi` is the full contract's source of truth.

/** One selectable app (Dock) icon as the shell reports it: stable id, human label, and a ~48px
 * data-URL preview the picker renders as its swatch (the page can't read the icon files itself). */
export interface DesktopAppIcon {
  id: string;
  label: string;
  dataUrl: string;
}

/** How the desktop shell acquired the backend serving this page: `bundled` = the app spawned and
 * owns it, `attached` = it reuses a shared daemon some CLI owns (the mode that can silently serve
 * stale code), `unknown` = the shell hasn't resolved a backend (e.g. dev-url mode). */
export type DesktopServerMode = "bundled" | "attached" | "unknown";

/** Stable id for one macOS permission row (Permissions card). Mirrors the shell's
 * `terminals/protocol.ts` — this repo's copy is the client-safe subset it actually renders.
 * `files` is ONE aggregated Files & Folders row over the per-folder Desktop/Documents/Downloads
 * TCC grants (the shell probes and prompts per folder under the hood). */
export type PermissionId = "files" | "full-disk-access" | "notifications" | "launch-at-login";

/** `partial` = the aggregated files row when only some folders are granted (row.note names the
 * missing ones). */
export type PermissionStatus = "granted" | "denied" | "not-determined" | "partial" | "unavailable";

/** One row's full state as the shell derives it (probe result + signed/dev flags folded in). */
export interface PermissionRowState {
  id: PermissionId;
  status: PermissionStatus;
  label: string;
  why: string;
  action: "prompt" | "open-settings" | "toggle" | "none";
  deepLink?: string;
  note?: string;
}

/** Claude.ai account status for the artifact-preview session (terminals/claudeai-auth.cts). */
export interface ClaudeAiAuthStatus {
  connected: boolean;
}

/** The desktop terminal settings object (mirrors the shell's terminals/protocol.ts
 * `TerminalSettings`, runtime source terminals/settings.cts). `keybinds` is read verbatim and
 * written back unchanged — the settings card renders it read-only, not editable. */
export interface TerminalSettings {
  fontFamily: string;
  /** int, clamped 8..32. */
  fontSize: number;
  ligatures: boolean;
  theme: string;
  appearance: "light" | "dark" | "system";
  /** 0..1. */
  backgroundOpacity: number;
  copyOnSelect: boolean;
  /** int, clamped 0..500000. */
  scrollback: number;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  renderer: "webgl" | "dom";
  /** null = the user's login shell, resolved at spawn. */
  shell: string | null;
  /** 0..1 — how strongly this workspace's hue tints the terminal background. */
  tintStrength: number;
  /** int px, clamped 0..24 — glass blur on the card's backdrop-filter (0 = no filter at all). */
  backgroundBlur: number;
  /** Recordable command shortcuts — rendered read-only here (see terminal-card.tsx). */
  keybinds: Record<string, string>;
}

/** The workspace the desktop shell currently has active (for labeling the "workspace tint"
 * control with a real name instead of a bare number). */
export interface DesktopWorkspace {
  id: string;
  path: string;
  name: string;
}

/** One desktop-shell setting as the shell describes it — this page renders purely off `kind`,
 * with zero knowledge of what any `key` MEANS (that meaning lives entirely on the shell side).
 * Every write (`setDesktopSetting`) resolves with the fresh FULL list, so the page always
 * re-renders from the shell's own return value instead of guessing the next state. */
export type DesktopDescriptor =
  | { key: string; kind: "toggle"; label: string; description?: string; value: boolean }
  | {
      key: string;
      kind: "select";
      label: string;
      description?: string;
      value: string;
      options: { value: string; label: string }[];
    }
  | { key: string; kind: "number"; label: string; description?: string; value: number };

export interface BeaconDesktopBridge {
  /** App-icon picker (Appearance card). `setAppIcon` persists + applies to the Dock immediately
   * and resolves with the id actually in effect (an unknown id is a shell-side no-op echo). */
  listAppIcons?: () => Promise<DesktopAppIcon[]>;
  getAppIcon?: () => Promise<string>;
  setAppIcon?: (id: string) => Promise<string>;
  /** Shell + backend identity for the Settings rail footer: the desktop app's own version and
   * whether it runs its bundled server or attached to a shared daemon. */
  getVersions?: () => Promise<{ app: string; serverMode: DesktopServerMode }>;
  /** Permissions card: current row states + whether this build is unsigned (grants may not
   * survive a rebuild). `grantPermission` fires the row's action shell-side (OS prompt / toggle /
   * open System Settings) and resolves with that row's resulting state. */
  listPermissions?: () => Promise<{ rows: PermissionRowState[]; unsignedBuild: boolean }>;
  grantPermission?: (id: PermissionId) => Promise<PermissionRowState>;
  /** Desktop section (Settings): the shell's own settings, described neutrally — this page just
   * renders by `kind` and never interprets a `key`. Today this is only `code.panelPosition`. */
  listDesktopSettings?: () => Promise<DesktopDescriptor[]>;
  setDesktopSetting?: (key: string, value: boolean | string | number) => Promise<DesktopDescriptor[]>;
  /** Claude.ai account (artifact-preview auth). `signIn`/`signOut` resolve with the resulting
   * status, same "fresh full state back" shape as the other write methods. */
  getClaudeAiAuthStatus?: () => Promise<ClaudeAiAuthStatus>;
  signInClaudeAi?: () => Promise<ClaudeAiAuthStatus>;
  signOutClaudeAi?: () => Promise<ClaudeAiAuthStatus>;
  /** Terminal settings card. `saveTerminalSettings` takes the whole object (not a partial) and
   * resolves with the shell's re-validated copy. `getCurrentWorkspace` labels the workspace-tint
   * control with a real name; optional/best-effort. */
  getTerminalSettings?: () => Promise<TerminalSettings>;
  saveTerminalSettings?: (settings: TerminalSettings) => Promise<TerminalSettings>;
  getCurrentWorkspace?: () => Promise<DesktopWorkspace | null>;
}

declare global {
  interface Window {
    /** Injected by the Beacon Desktop shell's preload; undefined in a plain browser and on the server. */
    beaconDesktop?: BeaconDesktopBridge;
  }
}

/** Listen for the shell's chrome-bar actions targeting one surface key. Returns the cleanup for
 * the caller's effect. No-op (empty cleanup) outside the shell. */
export function onShellAction(key: string, handler: (action: string) => void): () => void {
  if (!isDesktopShell()) return () => {};
  const listener = (e: MessageEvent): void => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const data = e.data as { __beaconShell?: unknown; key?: unknown; action?: unknown } | null;
    if (!data || data.__beaconShell !== "surface-action" || data.key !== key) return;
    if (typeof data.action === "string") handler(data.action);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
