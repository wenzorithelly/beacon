import { describe, expect, it } from "bun:test";
import { isViewPresenceLive, VIEW_PRESENCE_TTL_MS } from "@/lib/view-presence";

// The freshness rule the agent-ask bridge (bin/ask.ts) gates on: is the user ACTIVELY looking at a
// Beacon tab right now? The client beats this only while the tab is visible AND focused, so a
// backgrounded tab (open behind the terminal) goes stale and the question falls through to the
// terminal instead of being stranded on Beacon. Pure + timestamp-driven so it's testable sans FS.
describe("isViewPresenceLive", () => {
  it("is live for a recent heartbeat (within the TTL)", () => {
    expect(isViewPresenceLive(10_000, 10_000 + 5_000)).toBe(true);
  });

  it("is NOT live once the heartbeat is at or past the TTL", () => {
    expect(isViewPresenceLive(10_000, 10_000 + VIEW_PRESENCE_TTL_MS)).toBe(false);
    expect(isViewPresenceLive(10_000, 10_000 + VIEW_PRESENCE_TTL_MS + 1)).toBe(false);
  });

  it("is NOT live when there is no heartbeat on disk (Beacon backgrounded/closed)", () => {
    expect(isViewPresenceLive(null, 999_999)).toBe(false);
  });

  it("treats a just-written (or slightly clock-skewed future) heartbeat as live", () => {
    expect(isViewPresenceLive(10_000, 10_000)).toBe(true);
    expect(isViewPresenceLive(10_050, 10_000)).toBe(true);
  });
});
