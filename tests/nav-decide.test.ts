import { describe, expect, it } from "bun:test";
import { decideNav, INITIAL_NAV_STATE } from "@/lib/nav-decide";

// A base message with the non-nav/park fields defaulted, so each test only spells out what it's
// actually varying.
const msg = (over: Partial<Parameters<typeof decideNav>[1]>) => ({
  v: 0,
  navSeq: 0,
  navPath: "",
  navPark: false,
  navExcludeTab: "",
  ...over,
});

// The decision live-refresh makes on each SSE message: prime / refresh / push / park. The subtle
// bugs live here (don't fire a stale intent on connect; don't double-fire on reconnect; nav/park
// beat a plain version bump), so the logic is a pure reducer with no DOM/EventSource dependency.
describe("decideNav", () => {
  it("primes on the first message and takes no action", () => {
    const d = decideNav(INITIAL_NAV_STATE, msg({ v: 7, navSeq: 3, navPath: "/map?ws=a" }));
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state).toEqual({ primed: true, lastV: 7, lastNavSeq: 3 });
  });

  it("refreshes on a version-only change", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 8, navSeq: 3, navPath: "/map?ws=a" }));
    expect(d.action).toEqual({ kind: "refresh" });
    expect(d.state.lastV).toBe(8);
    expect(d.state.lastNavSeq).toBe(3);
  });

  it("pushes on a new nav.seq", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 7, navSeq: 4, navPath: "/map?ws=b" }));
    expect(d.action).toEqual({ kind: "push", path: "/map?ws=b" });
    expect(d.state.lastNavSeq).toBe(4);
  });

  it("prefers push over refresh when both version and nav.seq change", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 9, navSeq: 4, navPath: "/map?ws=b" }));
    expect(d.action).toEqual({ kind: "push", path: "/map?ws=b" });
    // The version tracker also advances so the next tick doesn't fire a stale refresh.
    expect(d.state.lastV).toBe(9);
    expect(d.state.lastNavSeq).toBe(4);
  });

  it("does nothing when neither changes", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 7, navSeq: 3, navPath: "/map" }));
    expect(d.action).toEqual({ kind: "none" });
  });

  it("a freshly primed tab ignores a pre-existing nav-intent (no stale push)", () => {
    const d = decideNav(INITIAL_NAV_STATE, msg({ v: 2, navSeq: 5, navPath: "/map?ws=old" }));
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state.lastNavSeq).toBe(5);
  });

  it("parks on a new seq carrying navPark (same precedence as push)", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 7, navSeq: 4, navPark: true, navExcludeTab: "tab-1" }));
    expect(d.action).toEqual({ kind: "park", excludeTab: "tab-1" });
    expect(d.state.lastNavSeq).toBe(4);
  });

  it("prefers park over refresh when both version and nav.seq change", () => {
    const primed = { primed: true, lastV: 7, lastNavSeq: 3 };
    const d = decideNav(primed, msg({ v: 9, navSeq: 4, navPark: true }));
    expect(d.action).toEqual({ kind: "park", excludeTab: "" });
    expect(d.state.lastV).toBe(9);
  });

  it("a freshly primed tab ignores a pre-existing park intent (no stale park)", () => {
    const d = decideNav(INITIAL_NAV_STATE, msg({ v: 2, navSeq: 5, navPark: true }));
    expect(d.action).toEqual({ kind: "none" });
    expect(d.state.lastNavSeq).toBe(5);
  });
});
