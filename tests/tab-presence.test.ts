import { describe, expect, it } from "bun:test";
import { isTabPresenceLive, TAB_PRESENCE_TTL_MS } from "@/lib/tab-presence";

// The freshness rule that decides whether the `beacon` CLI opens a fresh browser tab (no live
// tab for this workspace) or reuses the already-open one (a nav-intent the live tab picks up).
// Presence is recorded server-side by the SSE stream tick — an open EventSource IS a live tab.
// Pure + timestamp-driven so the decision is unit-testable without the FS.
describe("isTabPresenceLive", () => {
  it("is live for a recent heartbeat (within the TTL)", () => {
    expect(isTabPresenceLive(10_000, 10_000 + 5_000)).toBe(true);
  });

  it("is NOT live once the heartbeat is at or past the TTL", () => {
    expect(isTabPresenceLive(10_000, 10_000 + TAB_PRESENCE_TTL_MS)).toBe(false);
    expect(isTabPresenceLive(10_000, 10_000 + TAB_PRESENCE_TTL_MS + 1)).toBe(false);
  });

  it("is NOT live when there is no heartbeat on disk", () => {
    expect(isTabPresenceLive(null, 999_999)).toBe(false);
  });

  it("treats a just-written (or slightly clock-skewed future) heartbeat as live", () => {
    expect(isTabPresenceLive(10_000, 10_000)).toBe(true);
    expect(isTabPresenceLive(10_050, 10_000)).toBe(true);
  });
});
