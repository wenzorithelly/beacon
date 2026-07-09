import { describe, expect, it } from "bun:test";
import { nextNavIntent, nextParkIntent } from "@/lib/nav-intent";

// The monotonic seq is the dedup key the live tab relies on: a freshly-connected tab primes on
// the current seq and only acts on a LATER one, so a stale nav-intent left on disk never fires.
// Pure + arg-driven so the invariant is testable without the FS.
describe("nextNavIntent", () => {
  it("starts at seq 1 for the first intent (no prior)", () => {
    expect(nextNavIntent(null, "/map?ws=a", 100)).toEqual({
      seq: 1,
      path: "/map?ws=a",
      park: false,
      excludeTab: "",
      ts: 100,
    });
  });

  it("increments seq monotonically and updates the path", () => {
    const first = nextNavIntent(null, "/map?ws=a", 100);
    const second = nextNavIntent(first, "/map?ws=b", 200);
    expect(second).toEqual({
      seq: 2,
      path: "/map?ws=b",
      park: false,
      excludeTab: "",
      ts: 200,
    });
    const third = nextNavIntent(second, "/map?view=DATABASE", 300);
    expect(third).toEqual({
      seq: 3,
      path: "/map?view=DATABASE",
      park: false,
      excludeTab: "",
      ts: 300,
    });
  });

  it("never resets seq — repeating the same path keeps climbing", () => {
    let r = nextNavIntent(null, "/map", 1);
    for (let i = 2; i <= 5; i++) r = nextNavIntent(r, "/map", i);
    expect(r.seq).toBe(5);
  });
});

// nextParkIntent shares the same monotonic seq/channel as nextNavIntent (a park intent rides the
// same disk record + SSE delivery as a nav intent) but carries no path and sets `park: true`.
describe("nextParkIntent", () => {
  it("starts at seq 1 for the first intent (no prior)", () => {
    expect(nextParkIntent(null, 100)).toEqual({
      seq: 1,
      path: "",
      park: true,
      excludeTab: "",
      ts: 100,
    });
  });

  it("continues the SAME seq sequence as nav intents (shared channel)", () => {
    const nav = nextNavIntent(null, "/map?ws=a", 100);
    const park = nextParkIntent(nav, 200);
    expect(park.seq).toBe(2);
    expect(park.park).toBe(true);
    expect(park.path).toBe("");
  });

  it("carries an optional excludeTab (one tab that should not act on it)", () => {
    const park = nextParkIntent(null, 100, "tab-123");
    expect(park.excludeTab).toBe("tab-123");
  });
});
