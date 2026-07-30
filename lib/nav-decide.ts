// Pure decision logic for the live-refresh SSE listener (components/live-refresh.tsx). Kept in
// its own client-safe module — NO node:* imports — so the client bundle never pulls in the
// filesystem-backed nav-intent store, and the trickiest part of the feature stays unit-testable
// without a DOM/EventSource. The listener holds the state, resets it to INITIAL_NAV_STATE on
// each (re)connection (es.onopen), and applies the returned action.

/** Opaque per-board fingerprints from lib/board-revision.ts — compared for equality, never
 *  parsed. Optional everywhere: a stream that doesn't send them behaves exactly as before. */
export type BoardRev = Record<string, string>;

export interface NavStreamState {
  primed: boolean;
  lastV: number;
  lastNavSeq: number;
  /** Absent until a message carrying `rev` arrives, so a stream without fingerprints keeps
   *  producing byte-identical state objects. */
  lastRev?: BoardRev;
}

export interface NavStreamMessage {
  v: number;
  navSeq: number;
  navPath: string;
  navPark: boolean;
  navExcludeTab: string;
  rev?: BoardRev;
}

export type NavAction =
  | { kind: "none" }
  | { kind: "refresh" }
  | { kind: "push"; path: string }
  | { kind: "park"; excludeTab: string }
  /** The version bump was attributable to specific boards — reconcile those instead of
   *  reloading the page. Consumers that can't handle a board fall back to a refresh. */
  | { kind: "boards"; boards: string[] };

/** Keys whose fingerprint differs, sorted. Returns [] when there's nothing to compare against —
 *  which the caller reads as "unattributable", i.e. fall back to a full refresh. */
export function changedBoards(prev: BoardRev | undefined, next: BoardRev): string[] {
  if (!prev) return [];
  return Object.keys(next)
    .filter((k) => prev[k] !== next[k])
    .sort();
}

export interface NavDecision {
  state: NavStreamState;
  action: NavAction;
}

export const INITIAL_NAV_STATE: NavStreamState = { primed: false, lastV: -1, lastNavSeq: -1 };

export function decideNav(state: NavStreamState, msg: NavStreamMessage): NavDecision {
  // Spread in only when present, so a stream that never sends fingerprints yields the exact
  // same state shape it always did.
  const rev = msg.rev ? { lastRev: msg.rev } : undefined;
  // First message on a (re)connection just primes the trackers — never acts. Critical: a
  // freshly-opened tab (which already navigated to its own URL) must NOT fire a pre-existing
  // nav-intent, and an SSE reconnect must not replay the last one.
  if (!state.primed) {
    return {
      state: { primed: true, lastV: msg.v, lastNavSeq: msg.navSeq, ...rev },
      action: { kind: "none" },
    };
  }
  // A new nav-intent wins over a plain version bump (navigate, don't merely refresh). Advance
  // BOTH trackers so the next tick doesn't then fire a stale refresh for the same version. A
  // park intent takes the same precedence as a nav intent — they share one seq/channel — but
  // yields a distinct action so the caller can apply its own self-exclusion check.
  if (msg.navSeq !== state.lastNavSeq) {
    return {
      state: { primed: true, lastV: msg.v, lastNavSeq: msg.navSeq, ...rev },
      action: msg.navPark
        ? { kind: "park", excludeTab: msg.navExcludeTab }
        : { kind: "push", path: msg.navPath },
    };
  }
  // A version bump we can attribute to specific boards becomes a targeted reconcile; one we
  // can't (no fingerprints, or none of them moved — an edge label, a bug-flag resolve, a note,
  // a plan) stays the full refresh it has always been. Never silence.
  if (msg.v !== state.lastV) {
    const boards = msg.rev ? changedBoards(state.lastRev, msg.rev) : [];
    return {
      state: { ...state, lastV: msg.v, ...rev },
      action: boards.length ? { kind: "boards", boards } : { kind: "refresh" },
    };
  }
  return { state, action: { kind: "none" } };
}
