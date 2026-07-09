"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { decideNav, INITIAL_NAV_STATE, type NavStreamState } from "@/lib/nav-decide";
import { currentTabWs } from "@/lib/tab-ws";
import { currentTabId } from "@/lib/tab-id";

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
    // Establish this tab's own self-identity as soon as it's listening — not lazily, only inside
    // the park-exclusion check below — so anything that wants to learn "which tab is this" (e.g.
    // reading sessionStorage directly, same-origin) can do so from the moment the tab is live.
    currentTabId();
    const ws = currentTabWs();
    const es = new EventSource(ws ? `/api/stream?ws=${encodeURIComponent(ws)}` : "/api/stream");
    let state: NavStreamState = INITIAL_NAV_STATE;
    // Each (re)connection re-primes: the first post-connect message only seeds the trackers, so
    // an EventSource auto-reconnect can't double-fire a router.push for the last nav-intent.
    es.onopen = () => {
      state = INITIAL_NAV_STATE;
    };
    es.onmessage = (e) => {
      let msg: {
        v?: number;
        nav?: { seq?: number; path?: string; park?: boolean; excludeTab?: string };
      };
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
        navPark: msg.nav?.park ?? false,
        navExcludeTab: msg.nav?.excludeTab ?? "",
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
      } else if (action.kind === "park") {
        // This tab was named as the one exception in the broadcast — stay put.
        if (action.excludeTab && action.excludeTab === currentTabId()) return;
        // A FULL navigation, on purpose: the entire point is unmounting the whole app tree
        // (canvases, this very SSE connection, all hydrated React) instead of soft-navigating,
        // which would keep it all alive. /parked never re-subscribes to this stream, so a parked
        // tab ignores every intent that follows.
        const from = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/parked?from=${encodeURIComponent(from)}`);
      }
    };
    return () => es.close();
  }, [router]);

  // Beat a FOCUSED-view presence (lib/view-presence) only while THIS tab is the frontmost, visible
  // window. The agent-ask bridge (bin/ask.ts) gates on it: a question/approval is surfaced in
  // Beacon's modal only when the user is actually looking here — never when Beacon merely sits open
  // behind the terminal (which the SSE-connection tab-presence can't tell apart). When it goes
  // stale, the next agent question falls through to the terminal instead of being stranded here.
  useEffect(() => {
    const ws = currentTabWs();
    const beat = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      fetch("/api/tab/view", {
        method: "POST",
        headers: ws ? { "x-beacon-workspace": ws } : undefined,
      }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, 3_000);
    // Beat the instant focus/visibility is regained so switching to Beacon is picked up promptly.
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", beat);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
