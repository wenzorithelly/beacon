import { describe, expect, it } from "bun:test";
import { DELIVERER_PRESENCE_TTL_MS } from "@/lib/deliverer-registry";
import { DESKTOP_TAB_TTL_MS } from "@/lib/desktop-tab";
import { chooseReviewRoute, chooseReviewSurface } from "@/lib/open-review";

// A presented plan should route to beacon-desktop instead of popping the OS default browser
// whenever the desktop shell is attached for the target workspace — detected via the SAME
// deliverer-presence freshness the two-way ask bridge already relies on (lib/deliverer-registry.ts).
// Pure + arg-driven so the freshness math (and the "never heartbeated" / "stale" / "network error"
// edge cases) is testable without a filesystem or a running daemon.
describe("chooseReviewSurface", () => {
  it("routes to the browser when the workspace has never heartbeated (ts = null)", () => {
    expect(chooseReviewSurface(null, 1_000_000)).toBe("browser");
  });

  it("routes to the desktop immediately after a heartbeat", () => {
    expect(chooseReviewSurface(1_000_000, 1_000_000)).toBe("desktop");
  });

  it("stays on the desktop right up to the TTL boundary", () => {
    expect(chooseReviewSurface(1_000_000, 1_000_000 + DELIVERER_PRESENCE_TTL_MS - 1)).toBe("desktop");
  });

  it("falls back to the browser once the heartbeat has gone stale", () => {
    expect(chooseReviewSurface(1_000_000, 1_000_000 + DELIVERER_PRESENCE_TTL_MS)).toBe("browser");
  });

  it("honors an explicit ttlMs override", () => {
    expect(chooseReviewSurface(1_000_000, 1_001_500, 1_000)).toBe("browser");
    expect(chooseReviewSurface(1_000_000, 1_001_500, 2_000)).toBe("desktop");
  });
});

// The full routing decision: a live desktop WEB VIEW anywhere beats everything (owner's rule —
// "if the app is already opened then we do nothing in the browser"), the per-workspace deliverer
// heartbeat is the fallback desktop signal, and only when neither is present does the plan pop a
// browser tab. `intentWs` is WHERE the nav-intent must be written: the desktop tab only sees
// intents for the workspace its SSE stream is pinned to, so a cross-workspace plan targets the
// DESKTOP's workspace with a `/plan?ws=<plan-ws>` path that re-pins the view on arrival.
describe("chooseReviewRoute", () => {
  const NOW = 1_000_000;
  const fresh = NOW - 1;
  const stale = NOW - DESKTOP_TAB_TTL_MS;

  it("routes to the desktop tab's OWN workspace when its heartbeat is fresh — even for a plan in another workspace", () => {
    expect(chooseReviewRoute({ ts: fresh, ws: "desk-ws" }, null, "plan-ws", NOW)).toEqual({
      surface: "desktop",
      intentWs: "desk-ws",
    });
  });

  it("routes to the desktop tab when it is already on the plan's workspace", () => {
    expect(chooseReviewRoute({ ts: fresh, ws: "plan-ws" }, null, "plan-ws", NOW)).toEqual({
      surface: "desktop",
      intentWs: "plan-ws",
    });
  });

  it("a desktop-tab record with a blank workspace still routes desktop, targeting the plan's workspace", () => {
    expect(chooseReviewRoute({ ts: fresh, ws: "" }, null, "plan-ws", NOW)).toEqual({
      surface: "desktop",
      intentWs: "plan-ws",
    });
  });

  it("ignores a stale desktop-tab heartbeat (a just-quit app must NOT swallow the plan)", () => {
    expect(chooseReviewRoute({ ts: stale, ws: "desk-ws" }, null, "plan-ws", NOW)).toEqual({
      surface: "browser",
    });
  });

  it("desktop absent → falls back to the per-workspace deliverer heartbeat (existing behavior)", () => {
    expect(chooseReviewRoute(null, NOW - 1, "plan-ws", NOW)).toEqual({
      surface: "desktop",
      intentWs: "plan-ws",
    });
  });

  it("stale desktop tab + fresh deliverer → deliverer path targets the plan's workspace", () => {
    expect(chooseReviewRoute({ ts: stale, ws: "desk-ws" }, NOW - 1, "plan-ws", NOW)).toEqual({
      surface: "desktop",
      intentWs: "plan-ws",
    });
  });

  it("nobody present → browser open (never-heartbeated and stale both count as absent)", () => {
    expect(chooseReviewRoute(null, null, "plan-ws", NOW)).toEqual({ surface: "browser" });
    expect(
      chooseReviewRoute({ ts: stale, ws: "x" }, NOW - DELIVERER_PRESENCE_TTL_MS, "plan-ws", NOW),
    ).toEqual({ surface: "browser" });
  });
});
