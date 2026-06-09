import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { node, appSetting } from "@/lib/drizzle/schema";
import { describeFeature } from "@/lib/map-ops";
import { resetDb } from "./helpers";

beforeEach(resetDb);

// The feature loop's close-out: finishing a feature must drop the session's
// currentFeatureId pointer so edits stop auto-attaching — but only when it points
// at THIS feature, never another in-progress one.
describe("describeFeature clears the current-feature pointer", () => {
  it("nulls currentFeatureId when it points at the finished feature", async () => {
    const [n] = await db.insert(node).values({ view: "ROADMAP", title: "Some feature" }).returning();
    await db
      .insert(appSetting)
      .values({ id: "singleton", currentFeatureId: n.id })
      .onConflictDoUpdate({ target: appSetting.id, set: { currentFeatureId: n.id } });

    const r = await describeFeature({ id: n.id, description: "done", files: ["lib/x.ts"] });
    expect(r.ok).toBe(true);

    const s = await db.query.appSetting.findFirst({ where: (t, { eq }) => eq(t.id, "singleton") });
    expect(s?.currentFeatureId).toBeNull();
    expect(
      (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, n.id) }))?.status,
    ).toBe("DONE");
  });

  it("leaves a DIFFERENT in-progress feature's pointer untouched", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "Feature A" }).returning();
    const [b] = await db.insert(node).values({ view: "ROADMAP", title: "Feature B" }).returning();
    await db
      .insert(appSetting)
      .values({ id: "singleton", currentFeatureId: b.id })
      .onConflictDoUpdate({ target: appSetting.id, set: { currentFeatureId: b.id } });

    await describeFeature({ id: a.id, description: "done" });

    const s = await db.query.appSetting.findFirst({ where: (t, { eq }) => eq(t.id, "singleton") });
    expect(s?.currentFeatureId).toBe(b.id);
  });
});
