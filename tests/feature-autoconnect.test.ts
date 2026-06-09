import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { count, eq } from "drizzle-orm";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-autoconnect-"));

import { db } from "@/lib/db";
import { node, edge } from "@/lib/drizzle/schema";
import { getFeatureDraft, persistFeatureDraft } from "@/lib/feature-design";

describe("persistFeatureDraft auto-connect (dependsOn → DEPENDS edges)", () => {
  beforeEach(async () => {
    await db.delete(edge);
    await db.delete(node).where(eq(node.view, "ROADMAP"));
  });

  it("creates a DEPENDS edge between proposed features named in dependsOn", async () => {
    await persistFeatureDraft({
      features: [
        { title: "Search index" },
        { title: "Ranking", dependsOn: ["Search index"] },
      ],
    });
    const index = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Search index") });
    if (!index) throw new Error("not found");
    const ranking = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Ranking") });
    if (!ranking) throw new Error("not found");
    const e = await db.query.edge.findFirst({ where: (t, { eq }) => eq(t.kind, "DEPENDS") });
    if (!e) throw new Error("not found");
    expect(e.fromId).toBe(ranking.id); // "Ranking depends on Search index"
    expect(e.toId).toBe(index.id);
  });

  it("ignores unresolved titles and self-references without throwing", async () => {
    await persistFeatureDraft({
      features: [{ title: "Solo", dependsOn: ["Solo", "Ghost feature"] }],
    });
    expect((await db.select({ n: count() }).from(edge))[0].n).toBe(0);
  });

  it("round-trips dependsOn through getFeatureDraft", async () => {
    await persistFeatureDraft({
      features: [{ title: "A" }, { title: "B", dependsOn: ["A"] }],
    });
    const draft = await getFeatureDraft();
    const b = draft.features.find((f) => f.title === "B");
    expect(b?.dependsOn).toEqual(["A"]);
  });

  it("clusters a dependent feature near its prerequisite (organic layout), not near unrelated ones", async () => {
    await persistFeatureDraft({
      features: [
        { title: "Ranking", dependsOn: ["Search index"] },
        { title: "Search index" },
        { title: "Unrelated thing" },
      ],
    });
    const index = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Search index") });
    if (!index) throw new Error("not found");
    const ranking = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Ranking") });
    if (!ranking) throw new Error("not found");
    const unrelated = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Unrelated thing") });
    if (!unrelated) throw new Error("not found");
    const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(d(ranking, index)).toBeLessThan(d(ranking, unrelated));
  });

  it("re-proposing clears prior draft edges (cascade), no orphans", async () => {
    await persistFeatureDraft({ features: [{ title: "A" }, { title: "B", dependsOn: ["A"] }] });
    expect((await db.select({ n: count() }).from(edge))[0].n).toBe(1);
    await persistFeatureDraft({ features: [{ title: "C" }] }); // new draft, no deps
    expect((await db.select({ n: count() }).from(edge))[0].n).toBe(0);
  });
});
