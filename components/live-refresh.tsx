"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { decideNav, INITIAL_NAV_STATE, type NavStreamState } from "@/lib/nav-decide";

// Subscribes to the per-workspace sync SSE stream and reacts to each `{ v, nav }` message: a new
// nav-intent (written by the `beacon` CLI when it reuses this tab instead of opening a new one)
// → navigate here; a version bump (the intel daemon ingested new code-derived data) → refresh
// the open canvas in place. The EventSource carries this tab's `?ws=` so it keeps streaming its
// own workspace even after the browser-wide beacon_ws cookie drifts to another repo. The decision
// logic lives in the pure, unit-tested decideNav reducer; state resets on every (re)connection
// so a reconnect re-primes and never replays the last nav-intent.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const ws =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("ws")
        : null;
    const es = new EventSource(ws ? `/api/stream?ws=${encodeURIComponent(ws)}` : "/api/stream");
    let state: NavStreamState = INITIAL_NAV_STATE;
    // Each (re)connection re-primes: the first post-connect message only seeds the trackers, so
    // an EventSource auto-reconnect can't double-fire a router.push for the last nav-intent.
    es.onopen = () => {
      state = INITIAL_NAV_STATE;
    };
    es.onmessage = (e) => {
      let msg: { v?: number; nav?: { seq?: number; path?: string } };
      try {
        msg = JSON.parse(e.data);
      } catch {
        // Defensive: a non-JSON frame just refreshes (we own both ends, so this is rare).
        router.refresh();
        return;
      }
      const { state: next, action } = decideNav(state, {
        v: typeof msg.v === "number" ? msg.v : 0,
        navSeq: msg.nav?.seq ?? 0,
        navPath: msg.nav?.path ?? "",
      });
      state = next;
      if (action.kind === "refresh") {
        router.refresh();
      } else if (action.kind === "push" && action.path) {
        router.push(action.path);
        // Best-effort: ask the browser to surface this tab. Browsers usually ignore a
        // programmatic focus of a background tab, so it's a nice-to-have, never relied upon.
        try {
          window.focus();
        } catch {
          /* ignore */
        }
      }
    };
    return () => es.close();
  }, [router]);
  return null;
}
