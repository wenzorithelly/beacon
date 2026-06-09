import { afterEach, describe, expect, it } from "bun:test";
import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node, nodeFile } from "@/lib/drizzle/schema";
import { dedupeRoadmapByTitle } from "@/lib/init";

afterEach(async () => {
  await db.delete(nodeFile);
  await db.delete(node);
});

describe("dedupeRoadmapByTitle", () => {
  it("collapses same-title roadmap nodes, keeping the DONE one and merging files + category", async () => {
    // Re-approving an existing feature left a DONE original + a PENDING copy.
    const [done] = await db
      .insert(node)
      .values({ view: "ROADMAP", source: "MANUAL", title: "Normalization layer", status: "DONE" })
      .returning();
    await db.insert(nodeFile).values({ nodeId: done.id, path: "app/models/legal_type.py" });
    const [copy] = await db
      .insert(node)
      .values({
        view: "ROADMAP",
        source: "MANUAL",
        title: "Normalization layer",
        status: "PENDING",
        cluster: "DATA",
        priority: 1,
      })
      .returning();
    await db.insert(nodeFile).values({ nodeId: copy.id, path: "app/repositories/legal_type.py" });

    const removed = await dedupeRoadmapByTitle();
    expect(removed).toBe(1);

    const survivors = await db.query.node.findMany({
      where: (t, { and, eq }) => and(eq(t.view, "ROADMAP"), eq(t.title, "Normalization layer")),
      with: { files: true },
    });
    expect(survivors).toHaveLength(1);
    const keeper = survivors[0];
    expect(keeper.id).toBe(done.id); // the DONE node won
    expect(keeper.cluster).toBe("DATA"); // category backfilled from the dropped copy
    expect(keeper.priority).toBe(1); // most-urgent priority kept
    expect(keeper.files.map((f) => f.path).sort()).toEqual([
      "app/models/legal_type.py",
      "app/repositories/legal_type.py",
    ]);
  });

  it("is case/whitespace-insensitive on the title", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", source: "MANUAL", title: "Voyage Embeddings", status: "DONE" });
    await db
      .insert(node)
      .values({ view: "ROADMAP", source: "MANUAL", title: "  voyage embeddings ", status: "PENDING" });
    expect(await dedupeRoadmapByTitle()).toBe(1);
  });

  it("leaves a single feature untouched and never touches DRAFT (under-review) nodes", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", source: "MANUAL", title: "Solo feature", status: "PENDING" });
    // A DRAFT copy of an existing MANUAL feature is a plan under review — must NOT be deduped.
    await db
      .insert(node)
      .values({ view: "ROADMAP", source: "MANUAL", title: "Under review", status: "DONE" });
    await db
      .insert(node)
      .values({ view: "ROADMAP", source: "DRAFT", title: "Under review", status: "PENDING" });

    expect(await dedupeRoadmapByTitle()).toBe(0);
    expect((await db.select({ n: count() }).from(node).where(eq(node.view, "ROADMAP")))[0].n).toBe(3);
  });
});
