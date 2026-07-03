import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-baseline-"));

import { captureReviewBaseline, readReviewBaseline, resolveReviewBase } from "@/lib/review-baseline";

describe("review baseline", () => {
  it("captures the repo HEAD for a plan and reads it back", () => {
    // This test runs inside the beacon repo, which has commits — HEAD exists.
    captureReviewBaseline("plan0001");
    const b = readReviewBaseline();
    expect(b?.planId).toBe("plan0001");
    expect(b?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("resolveReviewBase: only the ACTIVE plan's baseline counts", () => {
    const b = { planId: "plan0001", sha: "a".repeat(40), at: 1 };
    expect(resolveReviewBase(b, "plan0001")).toBe(b.sha);
    expect(resolveReviewBase(b, "plan0002")).toBeNull(); // stale file from a finished plan
    expect(resolveReviewBase(b, null)).toBeNull(); // no active plan → plain HEAD
    expect(resolveReviewBase(null, "plan0001")).toBeNull();
  });
});
