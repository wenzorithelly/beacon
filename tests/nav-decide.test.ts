import { describe, expect, it } from "bun:test";
import { decideNav, INITIAL_NAV_STATE } from "@/lib/nav-decide";

// The decision live-refresh makes on each SSE message: prime / refresh / push. The subtle bugs
// live here (don't fire a stale intent on connect; don't double-fire on reconnect; nav beats a
// plain version bump), so the logic is a pure reducer with no DOM/EventSource dependency.
describe("decideNav", () => {
  it("primes on the first message and takes no action", () => {
    const d = decideNav(INITIAL_NAV_STATE, { v: 7, navSeq: 3, navPath: "/map?ws=a" });
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state).toEqual({ primed: true, lastV: 7, lastNavSeq: 3 });
  });

  it("refreshes on a version-only change", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, { v: 8, navSeq: 3, navPath: "/map?ws=a" });
    expect(d.action).toEqual({ kind: "refresh" });
    expect(d.state.lastV).toBe(8);
    expect(d.state.lastNavSeq).toBe(3);
  });

  it("pushes on a new nav.seq", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, { v: 7, navSeq: 4, navPath: "/map?ws=b" });
    expect(d.action).toEqual({ kind: "push", path: "/map?ws=b" });
    expect(d.state.lastNavSeq).toBe(4);
  });

  it("prefers push over refresh when both version and nav.seq change", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, { v: 9, navSeq: 4, navPath: "/map?ws=b" });
    expect(d.action).toEqual({ kind: "push", path: "/map?ws=b" });
    // The version tracker also advances so the next tick doesn't fire a stale refresh.
    expect(d.state.lastV).toBe(9);
    expect(d.state.lastNavSeq).toBe(4);
  });

  it("does nothing when neither changes", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, { v: 7, navSeq: 3, navPath: "/map" });
    expect(d.action).toEqual({ kind: "none" });
  });

  it("a freshly primed tab ignores a pre-existing nav-intent (no stale push)", () => {
    const d = decideNav(INITIAL_NAV_STATE, { v: 2, navSeq: 5, navPath: "/map?ws=old" });
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state.lastNavSeq).toBe(5);
  });
});
