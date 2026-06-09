import { describe, expect, it } from "bun:test";
import { isPlanPresenceLive, PLAN_PRESENCE_TTL_MS } from "@/lib/plan-presence";

// The freshness rule that decides whether the ExitPlanMode hook opens a fresh browser tab
// (no live /plan tab) or lets the already-open tab pick up the revised plan via its own poll
// (a live tab). Pure + timestamp-driven so the decision is unit-testable without the FS.
describe("isPlanPresenceLive", () => {
  it("is live for a recent heartbeat (within the TTL)", () => {
    expect(isPlanPresenceLive(10_000, 10_000 + 5_000)).toBe(true);
  });

  it("is NOT live once the heartbeat is at or past the TTL", () => {
    expect(isPlanPresenceLive(10_000, 10_000 + PLAN_PRESENCE_TTL_MS)).toBe(false);
    expect(isPlanPresenceLive(10_000, 10_000 + PLAN_PRESENCE_TTL_MS + 1)).toBe(false);
  });

  it("is NOT live when there is no heartbeat on disk", () => {
    expect(isPlanPresenceLive(null, 999_999)).toBe(false);
  });

  it("treats a just-written (or slightly clock-skewed future) heartbeat as live", () => {
    expect(isPlanPresenceLive(10_000, 10_000)).toBe(true);
    expect(isPlanPresenceLive(10_050, 10_000)).toBe(true);
  });
});
