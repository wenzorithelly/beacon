import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beaconHome } from "@/lib/workspaces";
import { writeJsonAtomic } from "@/lib/atomic-write";

// GLOBAL (cross-workspace) "the desktop shell's web view is open and streaming" heartbeat —
// deliberately NOT a makePresence() per-workspace file: the whole point is answering "is the
// desktop app open AT ALL?" for a plan proposed in ANY workspace (owner's rule, 2026-07-10: "if
// the app is already opened then we do nothing in the browser"). So it lives at the beaconHome()
// root — like workspaces.json / preferences.json — and records WHICH workspace the desktop tab is
// currently streaming, because that is the only nav-intent.json its SSE listener will act on
// (a cross-workspace plan writes its intent THERE, with a `/plan?ws=<plan-ws>` path that re-pins
// the web view on arrival).
//
// Recorded server-side by the SSE stream tick (app/api/stream) whenever the EventSource
// self-identifies with `?client=desktop` — components/live-refresh.tsx appends that exactly when
// lib/desktop-shell.ts's isDesktopShell() is true (the shell's preload stamped the DOM), so a
// plain browser tab can never impersonate the desktop. Read by lib/open-review.ts's routing.
//
// The shell hosts ONE web view, so last-writer-wins is the correct semantics.

export interface DesktopTabPresence {
  ts: number;
  ws: string;
}

// The stream ticks every 1s. This TTL is intentionally TIGHTER than tab-presence's 10s window:
// routing a plan to a desktop shell that just quit hands the nav-intent to nobody — the plan is
// swallowed into the void, which is strictly worse than the browser tab we suppressed. When the
// app quits, its EventSource drops, the stream's cancel() stops the ticks, and within 5s the
// record goes stale and plans fall back to the browser.
export const DESKTOP_TAB_TTL_MS = 5_000;

// Pure freshness rule (same shape as makePresence's isLiveAt, unit-testable without the fs): a
// null ts is never live; a just-written or slightly future-skewed ts is live; at/after the TTL
// it is not.
export function isDesktopTabLiveAt(
  ts: number | null,
  now: number,
  ttl: number = DESKTOP_TAB_TTL_MS,
): boolean {
  return ts !== null && now - ts < ttl;
}

function presencePath(): string {
  return join(beaconHome(), "desktop-tab.json");
}

export function readDesktopTabPresence(): DesktopTabPresence | null {
  try {
    const r = JSON.parse(readFileSync(presencePath(), "utf8")) as Partial<DesktopTabPresence>;
    return typeof r?.ts === "number"
      ? { ts: r.ts, ws: typeof r.ws === "string" ? r.ws : "" }
      : null;
  } catch {
    return null;
  }
}

export function recordDesktopTabPresence(now: number, ws: string): void {
  writeJsonAtomic(presencePath(), { ts: now, ws });
}
