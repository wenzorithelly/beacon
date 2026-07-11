import { DELIVERER_PRESENCE_TTL_MS, isDelivererLiveAt } from "@/lib/deliverer-registry";
import { isDesktopTabLiveAt, type DesktopTabPresence } from "@/lib/desktop-tab";

// Desktop-aware routing for review surfaces (currently: /plan, via lib/plan-open.ts's
// openPlanTabIfNone — the ExitPlanMode hook and the beacon_propose_plan/beacon_present_plan MCP
// tools both funnel through it). Without this, a presented plan always popped the OS default
// browser, even when beacon-desktop (an Electron shell around this same daemon) was already open —
// see docs/superpowers/specs/2026-07-09-desktop-ui-divergence-design.md and the beacon-desktop
// AGENTS.md architecture notes for the shell's side of this contract.
//
// The daemon has ZERO direct awareness of beacon-desktop. Two generic signals, strongest first:
//   1. The GLOBAL desktop-tab heartbeat (lib/desktop-tab.ts): the shell's own web view runs this
//      repo's components/live-refresh.tsx, whose EventSource self-identifies with `?client=desktop`
//      (gated on lib/desktop-shell.ts's isDesktopShell()), and the SSE tick records it. "The app is
//      open" — for ANY workspace — so even a plan from a plain-terminal agent in a workspace the
//      shell has never touched routes into the app instead of popping a browser tab behind it.
//   2. The per-workspace "a client can deliver input" heartbeat the two-way ask bridge already
//      relies on (lib/deliverer-registry.ts's deliverer-presence.json, exposed over GET
//      /api/deliverer): beacon-desktop's main.ts heartbeats it on its ~1.5s tick
//      (terminals/ask-deliverer.ts heartbeatDeliverer) for every workspace with a live agent
//      session running inside one of ITS OWN terminals. Kept as the fallback for the moment the
//      web view is reloading/detached while the shell is demonstrably alive for this workspace.
//
// When attached, routing happens via /api/tab/nav (lib/nav-intent.ts's setNavIntent) — the SAME
// per-workspace nav-intent.json the `beacon` CLI already writes to reuse an already-open browser
// tab instead of spawning a duplicate one (bin/beacon.ts). beacon-desktop's main.ts polls every
// workspace's nav-intent.json unconditionally (not gated on a live SSE tab) and raises + focuses
// the window on any seq bump (raiseOnNavIntent); the open page's own SSE listener
// (components/live-refresh.tsx) separately picks up the `path` and router.push()es there whenever
// it's already streaming that same workspace.

// Pure decision seam, unit-tested without touching the filesystem or network: given the freshest
// deliverer-presence timestamp for the target workspace (or null if it has never heartbeated) and
// the current time, which surface should a review push land on?
export function chooseReviewSurface(
  presenceTs: number | null,
  now: number,
  ttlMs: number = DELIVERER_PRESENCE_TTL_MS,
): "desktop" | "browser" {
  return isDelivererLiveAt(presenceTs, now, ttlMs) ? "desktop" : "browser";
}

// The FULL routing decision, pure and arg-driven (unit-tested in tests/open-review.test.ts).
// Signals, strongest first:
//   1. The GLOBAL desktop-tab heartbeat (lib/desktop-tab.ts — the shell's web view is streaming
//      SOMEWHERE). Owner's rule (2026-07-10): "if the app is already opened then we do nothing in
//      the browser" — so a live desktop tab wins even when it's pinned to a DIFFERENT workspace
//      than the plan's. This closed the juriscan_v2 bug: a plan from a plain-terminal agent in
//      another workspace popped a browser tab behind the already-open desktop app, because the
//      only signal was (2), which is per-workspace and desktop-terminal-gated.
//   2. The per-workspace deliverer heartbeat (the shell's main process heartbeats it for
//      workspaces with agent sessions in ITS OWN terminals) — kept as a fallback for the moment
//      the web view is reloading/detached but the shell is demonstrably alive for this workspace.
//   3. Neither → browser.
// `intentWs` is WHERE to write the nav-intent: the desktop tab's SSE stream only delivers intents
// for the workspace it is pinned to, so a cross-workspace plan writes into the DESKTOP's
// workspace; the `/plan?ws=<plan-ws>` path re-pins the web view when it lands (lib/tab-ws.ts).
export type ReviewRoute = { surface: "desktop"; intentWs: string } | { surface: "browser" };

export function chooseReviewRoute(
  desktopTab: { ts: number | null; ws: string } | null,
  delivererTs: number | null,
  planWs: string,
  now: number,
): ReviewRoute {
  if (desktopTab && isDesktopTabLiveAt(desktopTab.ts, now)) {
    return { surface: "desktop", intentWs: desktopTab.ws || planWs };
  }
  if (chooseReviewSurface(delivererTs, now) === "desktop") {
    return { surface: "desktop", intentWs: planWs };
  }
  return { surface: "browser" };
}

// Impure orchestration: check whether a desktop shell is attached — for wsId OR anywhere (a live
// desktop web view in ANY workspace catches the plan) — and, if so, hand it a nav-intent instead
// of the caller opening a browser tab. Returns true when it routed to the desktop (caller should
// skip its own browser-open fallback), false otherwise (network error counts as "not attached" —
// fail open to the existing browser behavior, same as every other presence check in this
// codebase, e.g. lib/plan-open.ts's live-tab check). Both signals ride the ONE workspace-pinned
// GET /api/deliverer round trip (the global desktopTab record tags along).
export async function routeToDesktopIfAttached(base: string, wsId: string, path: string): Promise<boolean> {
  const p = await fetch(`${base}/api/deliverer`, { headers: { "x-beacon-workspace": wsId } })
    .then((r) => r.json() as Promise<{ ts?: unknown; desktopTab?: unknown }>)
    .catch(() => null);
  const ts = typeof p?.ts === "number" ? p.ts : null;
  const dt = p?.desktopTab as Partial<DesktopTabPresence> | null | undefined;
  const desktopTab =
    dt && typeof dt.ts === "number" ? { ts: dt.ts, ws: typeof dt.ws === "string" ? dt.ws : "" } : null;
  const route = chooseReviewRoute(desktopTab, ts, wsId, Date.now());
  if (route.surface !== "desktop") return false;
  await fetch(`${base}/api/tab/nav`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-beacon-workspace": route.intentWs },
    body: JSON.stringify({ path }),
  }).catch(() => {});
  return true;
}
