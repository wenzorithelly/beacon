"use client";

// The workspace a /plan tab is pinned to, read from the `?ws=<id>` URL param the ExitPlanMode
// hook opens it with. This is PER-TAB — unlike the browser-wide `beacon_ws` cookie — so two
// terminal sessions can each have their own plan open at once and a verdict/feedback routes to
// the repo whose agent is actually waiting.
//
// Read at call-time from window.location (not via useSearchParams) so no Suspense boundary is
// required for the layout-level PlanProvider, and a freshly-changed param is always reflected.
// Returns null during SSR or off a `?ws` URL → the server falls back to the cookie/active
// workspace (single-workspace flow unchanged).
export function currentPlanWs(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("ws");
}

// Re-exported from the shared per-tab util (single implementation, used here + app-wide).
export { wsHeaders } from "@/lib/tab-ws";

// The plan currently selected in history, read from `?plan=<id>`. Preserved across the
// Plan history ↔ Changes toggle so switching to Changes shows the SELECTED plan (its saved
// file list when it isn't the one executing), not always the latest.
export function currentPlanSelection(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("plan");
}

// Build a /plan URL that PRESERVES this tab's `?ws` pin AND the current `?plan` selection, so
// in-tab navigations (browse history, toggle to Changes, back to the current plan) stay on the
// same repo and the same selected plan instead of resetting. `extra` adds/overrides params
// (e.g. { view: "history" }); pass `plan: ""` to explicitly drop the selection.
export function planHref(extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  const ws = currentPlanWs();
  if (ws) params.set("ws", ws);
  const plan = currentPlanSelection();
  if (plan) params.set("plan", plan);
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === "") params.delete(k);
    else params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/plan?${qs}` : "/plan";
}
