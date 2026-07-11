import { describe, expect, it } from "bun:test";
import {
  DESKTOP_TAB_TTL_MS,
  isDesktopTabLiveAt,
  readDesktopTabPresence,
  recordDesktopTabPresence,
} from "@/lib/desktop-tab";

// GLOBAL (cross-workspace) "the desktop shell's web view is streaming" heartbeat. Recorded by the
// SSE stream tick when the EventSource self-identifies as the desktop client, read by the review
// routing (lib/open-review.ts) so a plan proposed in ANY workspace lands in the already-open
// desktop app instead of popping a browser tab. The TTL is deliberately TIGHTER than the browser
// tab-presence window: a nav-intent handed to a dead shell is a plan swallowed into the void,
// which is worse than an extra browser tab.
describe("isDesktopTabLiveAt", () => {
  it("is live for a recent heartbeat (within the TTL)", () => {
    expect(isDesktopTabLiveAt(10_000, 10_000 + DESKTOP_TAB_TTL_MS - 1)).toBe(true);
  });

  it("is NOT live once the heartbeat is at or past the TTL", () => {
    expect(isDesktopTabLiveAt(10_000, 10_000 + DESKTOP_TAB_TTL_MS)).toBe(false);
    expect(isDesktopTabLiveAt(10_000, 10_000 + DESKTOP_TAB_TTL_MS + 1)).toBe(false);
  });

  it("is NOT live when there is no heartbeat on disk", () => {
    expect(isDesktopTabLiveAt(null, 999_999)).toBe(false);
  });

  it("treats a just-written (or slightly clock-skewed future) heartbeat as live", () => {
    expect(isDesktopTabLiveAt(10_000, 10_000)).toBe(true);
    expect(isDesktopTabLiveAt(10_050, 10_000)).toBe(true);
  });
});

describe("desktop-tab presence record", () => {
  it("roundtrips the heartbeat timestamp AND the workspace the desktop tab is streaming", () => {
    recordDesktopTabPresence(123_456, "ws-desktop");
    expect(readDesktopTabPresence()).toEqual({ ts: 123_456, ws: "ws-desktop" });
  });

  it("last writer wins — a later tick replaces the record", () => {
    recordDesktopTabPresence(1_000, "ws-a");
    recordDesktopTabPresence(2_000, "ws-b");
    expect(readDesktopTabPresence()).toEqual({ ts: 2_000, ws: "ws-b" });
  });
});
