"use client";

// Per-tab workspace identity for the whole browser app. The browser-wide `beacon_ws` cookie is
// shared across every tab, so it can't express "this tab shows repo A while that tab shows repo
// B" — switching one tab would drag the others. Instead each tab carries its workspace in the
// `?ws=<id>` URL param (what the RSC render reads) anchored in sessionStorage (genuinely per-tab,
// and sticky across an in-tab navigation that drops the param). Every client /api request from a
// tab sends it as the `x-beacon-workspace` header (see components/tab-workspace), which the API
// routes honor over the cookie. This generalizes the /plan per-tab pattern (use-plan-ws) app-wide.

export const TAB_WS_KEY = "beacon:tab-ws";

// Pure precedence: the URL param wins (a fresh ?ws re-pins the tab), then the sticky stored value,
// then null (server falls back to the cookie / global active workspace).
export function resolveTabWs(param: string | null, stored: string | null): string | null {
  return param || stored || null;
}

// This tab's workspace (client only). Persists a present ?ws into sessionStorage so the pin
// survives an in-tab navigation that drops the query param; returns null off any ws (SSR / a
// brand-new tab) so the server falls back to the cookie/active workspace.
export function currentTabWs(): string | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("ws");
  let stored: string | null = null;
  try {
    if (param) sessionStorage.setItem(TAB_WS_KEY, param);
    stored = sessionStorage.getItem(TAB_WS_KEY);
  } catch {
    /* sessionStorage unavailable — fall back to the URL param alone */
  }
  return resolveTabWs(param, stored);
}

// Set this tab's workspace (the switcher); the caller then navigates so the RSC re-renders pinned.
export function setTabWs(id: string): void {
  try {
    sessionStorage.setItem(TAB_WS_KEY, id);
  } catch {
    /* ignore */
  }
}

// Spread into a fetch's headers to pin the request to a workspace. The API routes resolve via
// workspaceIdFromRequest, which checks x-beacon-workspace BEFORE the cookie. No-op when null.
export function wsHeaders(ws: string | null): Record<string, string> {
  return ws ? { "x-beacon-workspace": ws } : {};
}

// Pure href builder — preserves the tab's ws and adds any extra query params.
export function buildTabHref(
  path: string,
  ws: string | null,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (ws) params.set("ws", ws);
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// Build an internal href that keeps THIS tab pinned (reads the live ws). Use for nav links so
// clicking Map / Plans / Settings doesn't drop the pin and fall back to the shared cookie.
export function tabHref(path: string, extra?: Record<string, string>): string {
  return buildTabHref(path, currentTabWs(), extra);
}

// Should the fetch interceptor attach the per-tab workspace header? Only same-origin /api/*
// requests — page/RSC navigations (to page paths) and cross-origin calls are left untouched.
export function isApiRequest(url: string, origin: string): boolean {
  if (url.startsWith("/api/")) return true;
  try {
    const u = new URL(url, origin);
    return u.origin === origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}
