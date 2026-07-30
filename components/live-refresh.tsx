"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { decideNav, INITIAL_NAV_STATE, type NavStreamState } from "@/lib/nav-decide";
import { currentTabWs } from "@/lib/tab-ws";
import { currentTabId } from "@/lib/tab-id";
import { isDesktopShell } from "@/lib/desktop-shell";

/**
 * Fired on `window` when a version bump was attributable to specific boards (see
 * lib/board-revision.ts). `detail.boards` holds the board keys that changed — "roadmap", "db",
 * "code".
 *
 * The event is CANCELABLE and that is the whole contract: a surface that reconciles a board
 * itself calls `preventDefault()` to claim the change; if nobody claims it, LiveRefresh falls
 * back to the `router.refresh()` it has always done. So every page that doesn't listen (/plan,
 * /learn, /settings…) keeps refreshing exactly as before, and a canvas that DOES listen stops
 * paying for a full server-component re-render on unrelated changes.
 *
 *   useEffect(() => {
 *     const onBoards = (e: Event) => {
 *       const { boards } = (e as CustomEvent<BoardsChangedDetail>).detail;
 *       if (!boards.includes("roadmap")) return;
 *       e.preventDefault();              // claim it — suppresses the full refresh
 *       void refetchAndReconcileById();
 *     };
 *     window.addEventListener(BOARDS_CHANGED_EVENT, onBoards);
 *     return () => window.removeEventListener(BOARDS_CHANGED_EVENT, onBoards);
 *   }, []);
 */
export const BOARDS_CHANGED_EVENT = "beacon:boards-changed";
export interface BoardsChangedDetail {
  boards: string[];
}

// Subscribes to the per-workspace sync SSE stream and reacts to each `{ v, nav, rev }` message: a
// new nav-intent (written by the `beacon` CLI when it reuses this tab instead of opening a new
// one) → navigate here; a version bump → either a targeted `beacon:boards-changed` event (when
// `rev` pins down which boards moved) or, when it can't be attributed, the full refresh. The
// EventSource carries this tab's `?ws=` so it keeps streaming its own workspace even after the
// browser-wide beacon_ws cookie drifts to another repo. The decision logic lives in the pure,
// unit-tested decideNav reducer; state resets on every (re)connection so a reconnect re-primes
// and never replays the last nav-intent.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    // Establish this tab's own self-identity as soon as it's listening — not lazily, only inside
    // the park-exclusion check below — so anything that wants to learn "which tab is this" (e.g.
    // reading sessionStorage directly, same-origin) can do so from the moment the tab is live.
    currentTabId();
    const ws = currentTabWs();
    const params = new URLSearchParams();
    if (ws) params.set("ws", ws);
    // Self-identify as the desktop shell's web view (preload-stamped DOM, lib/desktop-shell.ts).
    // The stream tick then beats the GLOBAL desktop-tab presence, which is what lets a plan
    // proposed in ANY workspace route into the open app instead of popping a browser tab.
    if (isDesktopShell()) params.set("client", "desktop");
    const qs = params.toString();
    const es = new EventSource(qs ? `/api/stream?${qs}` : "/api/stream");
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
        rev?: Record<string, string>;
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
        rev: msg.rev,
      });
      state = next;
      if (action.kind === "refresh") {
        router.refresh();
      } else if (action.kind === "boards") {
        // Offer the change to whoever renders those boards. Unclaimed → the old full refresh,
        // so a page with no listener is unaffected by any of this.
        const claimed = !window.dispatchEvent(
          new CustomEvent<BoardsChangedDetail>(BOARDS_CHANGED_EVENT, {
            detail: { boards: action.boards },
            cancelable: true,
          }),
        );
        if (!claimed) router.refresh();
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
