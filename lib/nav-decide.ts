// Pure decision logic for the live-refresh SSE listener (components/live-refresh.tsx). Kept in
// its own client-safe module — NO node:* imports — so the client bundle never pulls in the
// filesystem-backed nav-intent store, and the trickiest part of the feature stays unit-testable
// without a DOM/EventSource. The listener holds the state, resets it to INITIAL_NAV_STATE on
// each (re)connection (es.onopen), and applies the returned action.

export interface NavStreamState {
  primed: boolean;
  lastV: number;
  lastNavSeq: number;
}

export interface NavStreamMessage {
  v: number;
  navSeq: number;
  navPath: string;
}

export type NavAction =
  | { kind: "none" }
  | { kind: "refresh" }
  | { kind: "push"; path: string };

export interface NavDecision {
  state: NavStreamState;
  action: NavAction;
}

export const INITIAL_NAV_STATE: NavStreamState = { primed: false, lastV: -1, lastNavSeq: -1 };

export function decideNav(state: NavStreamState, msg: NavStreamMessage): NavDecision {
  // First message on a (re)connection just primes the trackers — never acts. Critical: a
  // freshly-opened tab (which already navigated to its own URL) must NOT fire a pre-existing
  // nav-intent, and an SSE reconnect must not replay the last one.
  if (!state.primed) {
    return {
      state: { primed: true, lastV: msg.v, lastNavSeq: msg.navSeq },
      action: { kind: "none" },
    };
  }
  // A new nav-intent wins over a plain version bump (navigate, don't merely refresh). Advance
  // BOTH trackers so the next tick doesn't then fire a stale refresh for the same version.
  if (msg.navSeq !== state.lastNavSeq) {
    return {
      state: { primed: true, lastV: msg.v, lastNavSeq: msg.navSeq },
      action: { kind: "push", path: msg.navPath },
    };
  }
  if (msg.v !== state.lastV) {
    return {
      state: { ...state, lastV: msg.v },
      action: { kind: "refresh" },
    };
  }
  return { state, action: { kind: "none" } };
}
