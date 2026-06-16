import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-bug-kind-"));

import { db } from "@/lib/db";
import { getFeatureDraft, persistFeatureDraft } from "@/lib/feature-design";
import { persistRoadmap } from "@/lib/init";
import { addSubtasksUnder, startFeature } from "@/lib/map-ops";
import { createNode } from "@/lib/mutations";
import { resetDb } from "./helpers";

beforeEach(resetDb);

// Every agent surface that creates roadmap cards must be able to type them as bugs.

describe("propose_plan / ```beacon block — featureItemSchema kind", () => {
  it("persists a kind=BUG draft feature", async () => {
    await persistFeatureDraft({
      features: [
        { title: "Fix verdict race", cluster: "PLAN", priority: 1, kind: "BUG" },
        { title: "Plain feature", cluster: "PLAN", priority: 2 },
      ],
    });
    const bug = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Fix verdict race"),
    });
    const feat = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Plain feature"),
    });
    expect(bug?.kind).toBe("BUG");
    expect(bug?.source).toBe("DRAFT");
    expect(feat?.kind).toBe("FEATURE");
  });

  it("is tolerant of lowercase kind", async () => {
    await persistFeatureDraft({
      features: [{ title: "Lowercase bug", cluster: "PLAN", priority: 2, kind: "bug" }],
    });
    const n = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Lowercase bug"),
    });
    expect(n?.kind).toBe("BUG");
  });

  it("round-trips kind through getFeatureDraft", async () => {
    await persistFeatureDraft({
      features: [{ title: "Fix verdict race", cluster: "PLAN", priority: 1, kind: "BUG" }],
    });
    const draft = await getFeatureDraft();
    expect(draft.features[0].kind).toBe("BUG");
  });
});

describe("beacon_init_persist — roadmap items with kind", () => {
  it("persists a kind=BUG roadmap item", async () => {
    await persistRoadmap([
      { title: "Fix watcher leak", category: "INTEL", priority: 1, kind: "BUG" },
      { title: "Strategic theme" },
    ]);
    const bug = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Fix watcher leak"),
    });
    const theme = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Strategic theme"),
    });
    expect(bug?.kind).toBe("BUG");
    expect(theme?.kind).toBe("FEATURE");
  });
});

describe("beacon_feature (add/start) — kind", () => {
  it("creates a new node as a BUG when kind is passed", async () => {
    const r = await startFeature({
      title: "Crash when approving an empty plan",
      cluster: "PLAN",
      kind: "BUG",
    });
    expect(r.action).toBe("created");
    const n = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Crash when approving an empty plan"),
    });
    expect(n?.kind).toBe("BUG");
    expect(n?.status).toBe("IN_PROGRESS");
  });
});

describe("beacon_feature (subtasks) — kind per item", () => {
  it("creates a BUG sub-task under a roadmap feature", async () => {
    const parent = await createNode({ view: "ROADMAP", title: "Parent feature", cluster: "PLAN" });
    const r = await addSubtasksUnder({
      parentId: parent.id,
      items: [
        { title: "Fix off-by-one in layout", kind: "BUG" },
        { title: "Normal follow-up" },
      ],
    });
    expect(r.ok).toBe(true);
    const bug = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Fix off-by-one in layout"),
    });
    const normal = await db.query.node.findFirst({
      where: (t, { eq }) => eq(t.title, "Normal follow-up"),
    });
    expect(bug?.kind).toBe("BUG");
    expect(bug?.parentId).toBe(parent.id);
    expect(normal?.kind).toBe("FEATURE");
  });
});
