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
// SCOPE (2026-07-29): this file is the postMessage surface-state/surface-action bridge, and NOTHING
// else. It used to also mirror the shell's whole `window.beaconDesktop` contextBridge API — terminal
// settings, macOS permission rows, the claude.ai session, the Dock-icon picker, and Beacon's AI proxy
// spend/quota — ~206 lines describing a proprietary product's internals inside a public Apache-2.0
// repo, which OSS-POLICY.md's own rule ("the proprietary layer must live in a separate, private
// repository") forbids. It was also a hand-maintained SECOND copy of the shell's protocol.ts, and it
// had already drifted: `getCurrentWorkspace` was declared here as a record while the shell returned a
// bare id string, so the terminal-tint row rendered "How strongly undefined's hue tints the
// background."
//
// All of it now lives in the shell's own Settings window (beacon-desktop `settings/`). Anything that
// needs a real macOS/Electron capability belongs there, not here. What stays in this repo's /settings
// is what a browser can genuinely honour: theme and surface, the agent's plan permission mode, Linear,
// project context, and the danger zone.
//
// Client-safe: no node imports, no react — usable from any client component's effect.

// Type-only (erased at build): the appearance vocabulary has ONE definition, in lib/appearance.ts,
// and this bridge re-exports it rather than restating the unions. No runtime edge, so no cycle with
// appearance.ts's own report call below.
import type { Surface, Theme } from "@/lib/appearance";

/** Keys for shell-mirrored surfaces. Add new surfaces here so both repos share one vocabulary. */
export const SHELL_SURFACE = {
  planHeader: "plan-header",
  learnHeader: "learn-header",
  appearance: "appearance",
} as const;

/** Theme + surface, mirrored so the shell's own Settings window can draw them (beacon-desktop
 * settings/settings-panel.cts, Appearance section). The first APP-level key on this bridge rather
 * than a page-level one: it is reported from the app shell (components/theme/appearance-sync.tsx),
 * so it is live on every route, not just /settings.
 *
 * Why it crosses at all: under the shell these two preferences theme the WHOLE app — the chrome bar,
 * the terminal panes, the artifact rail and the file peek all follow the resolved value — while the
 * shell's chrome hides this app's own top nav, so /settings (where appearance-card.tsx lives) is not
 * reachable there. The preferences still belong here, where a browser can honour them; only the
 * control moves. Actions the shell sends back: `theme:<light|dark|auto>`, `surface:<glass|tinted|solid>`. */
export interface AppearanceState {
  theme: Theme;
  surface: Surface;
}

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
