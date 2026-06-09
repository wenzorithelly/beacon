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

// Spread into a fetch's headers so the request pins to the tab's workspace. The API routes
// resolve the workspace via workspaceIdFromRequest, which checks `x-beacon-workspace` BEFORE
// the cookie — so this overrides whatever workspace the shared cookie currently points at.
// No-op when ws is null (cookie/active fallback).
export function wsHeaders(ws: string | null): Record<string, string> {
  return ws ? { "x-beacon-workspace": ws } : {};
}

// Build a /plan URL that PRESERVES this tab's `?ws` pin, so in-tab navigations (browse history,
// back to the current plan) stay on the same repo instead of falling back to the shared cookie.
// `extra` adds further query params (e.g. { view: "history" }).
export function planHref(extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  const ws = currentPlanWs();
  if (ws) params.set("ws", ws);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `/plan?${qs}` : "/plan";
}
