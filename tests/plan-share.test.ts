import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-plan-share-"));

import { resetDb } from "./helpers";
import { clearPlanMeta, writePlanMeta } from "@/lib/plan-meta";
import { archivePlan } from "@/lib/plan-history";
import { buildPendingPlanSnapshot, buildArchivedPlanSnapshot } from "@/lib/plan-share";
import { shareSnapshotSchema } from "@/lib/share-snapshot";

beforeEach(async () => {
  await resetDb();
  clearPlanMeta();
});

describe("buildPendingPlanSnapshot", () => {
  it("returns null when there is no pending plan", async () => {
    expect(await buildPendingPlanSnapshot()).toBeNull();
  });

  it("captures the open plan's markdown with verdict=null", async () => {
    writePlanMeta({ description: "Plan X", proposedAt: 1, markdown: "# Plan X\n\nbody" });
    const snap = await buildPendingPlanSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.kind).toBe("plan");
    expect(snap!.verdict).toBeNull();
    expect(snap!.markdown).toContain("Plan X");
    expect(shareSnapshotSchema.safeParse(snap).success).toBe(true);
  });
});

describe("buildArchivedPlanSnapshot", () => {
  it("returns null for an unknown id", async () => {
    expect(await buildArchivedPlanSnapshot("nope")).toBeNull();
  });

  it("captures a past plan's markdown, verdict, and proposed features board", async () => {
    const archived = archivePlan({
      description: "Old plan",
      markdown: "# Old plan\n\nshipped",
      verdict: "approved",
      featureGraph: { features: [{ title: "F1", cluster: "DATA", priority: 1 }] },
    });
    const snap = await buildArchivedPlanSnapshot(archived.id);
    expect(snap).not.toBeNull();
    expect(snap!.verdict).toBe("approved");
    expect(snap!.markdown).toContain("Old plan");
    expect(snap!.roadmap!.nodes.some((n) => n.title === "F1")).toBe(true);
    expect(shareSnapshotSchema.safeParse(snap).success).toBe(true);
  });
});
