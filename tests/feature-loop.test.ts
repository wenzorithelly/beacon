import { beforeEach, describe, expect, it } from "bun:test";
import { db } from "@/lib/db";
import { node, appSetting } from "@/lib/drizzle/schema";
import { describeFeature, describeFeatures } from "@/lib/map-ops";
import { POST as describePost } from "@/app/api/map/describe/route";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("POST /api/map/describe — batch wire shape", () => {
  it("accepts a features[] body and flips every node DONE in one request", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "One" }).returning();
    const [b] = await db.insert(node).values({ view: "ROADMAP", title: "Two" }).returning();

    const res = await describePost(
      new Request("http://test/api/map/describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          features: [
            { id: a.id, description: "one done", files: ["lib/one.ts"] },
            { id: b.id, description: "two done" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: Array<{ ok: boolean }> };
    expect(json.results.length).toBe(2);
    expect(json.results.every((r) => r.ok)).toBe(true);
    expect((await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, b.id) }))?.status).toBe("DONE");
  });
});

// Batch close-out: register N shipped features in ONE call instead of one round-trip
// each. The agent gets the ids back at approval, so it never fuzzy-matches by title.
describe("describeFeatures — batch register", () => {
  it("marks every feature DONE in one call, resolving by id and by title", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "Alpha" }).returning();
    const [b] = await db.insert(node).values({ view: "ROADMAP", title: "Beta feature" }).returning();

    const { results } = await describeFeatures([
      { id: a.id, description: "a done", files: ["lib/a.ts"] },
      { title: "Beta feature", description: "b done" },
    ]);

    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, a.id) }))?.status).toBe("DONE");
    expect((await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, b.id) }))?.status).toBe("DONE");
  });

  it("reports a per-item failure (with its title) without sinking the rest of the batch", async () => {
    const [a] = await db.insert(node).values({ view: "ROADMAP", title: "Gamma" }).returning();

    const { results } = await describeFeatures([
      { id: a.id, description: "a done" },
      { title: "Nonexistent zzz", description: "x" },
    ]);

    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].title).toBe("Nonexistent zzz");
    expect((await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, a.id) }))?.status).toBe("DONE");
  });
});

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
