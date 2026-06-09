import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// The signature file healRoadmapLayout reads/writes lives in the workspace data dir — isolate it.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-roadmap-heal-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node, edge } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { healRoadmapLayout } from "@/lib/map-ops";

beforeEach(resetDb);

async function nodeById(id: string) {
  const r = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  if (!r) throw new Error("not found");
  return r;
}

const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

// Opening /map heals the board: it re-arranges organically (d3-force) when the graph structure
// changed since the last layout, and otherwise leaves the user's arrangement (drag / Group-by)
// alone.
describe("healRoadmapLayout", () => {
  it("organically re-arranges a stale board so linked features cluster", async () => {
    const [hub] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Hub", cluster: "DATA", status: "PENDING", x: 0, y: 0 })
      .returning();
    const [dep] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Dependent", cluster: "DATA", status: "PENDING", x: 3000, y: 0 })
      .returning();
    const [iso] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Isolated", cluster: "DATA", status: "PENDING", x: 6000, y: 0 })
      .returning();
    await db.insert(edge).values({ fromId: dep.id, toId: hub.id, kind: "DEPENDS" });

    await healRoadmapLayout();

    const h = await nodeById(hub.id);
    const dp = await nodeById(dep.id);
    const is = await nodeById(iso.id);
    expect(d(h, dp)).toBeLessThan(d(h, is)); // linked pair closer than the unrelated one
  });

  it("leaves positions alone on a second call when the structure is unchanged", async () => {
    const [a] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "A", cluster: "DATA", status: "PENDING", x: 0, y: 0 })
      .returning();
    const [b] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "B", cluster: "DATA", status: "PENDING", x: 5000, y: 0 })
      .returning();
    await db.insert(edge).values({ fromId: b.id, toId: a.id, kind: "DEPENDS" });

    await healRoadmapLayout(); // first heal lays it out and records the signature
    const a1 = await nodeById(a.id);

    // Simulate a manual drag AFTER the layout — structure is unchanged.
    await db.update(node).set({ x: a1.x + 777, y: a1.y - 333 }).where(eq(node.id, a.id));
    await healRoadmapLayout(); // must NOT clobber the drag

    const a2 = await nodeById(a.id);
    expect(a2.x).toBe(a1.x + 777);
    expect(a2.y).toBe(a1.y - 333);
  });

  it("re-lays-out when a feature is added (structure changed)", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "A", cluster: "DATA", status: "PENDING", x: 0, y: 0 });
    const [b] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "B", cluster: "DATA", status: "PENDING", x: 5000, y: 0 })
      .returning();
    await healRoadmapLayout();

    // Add a third feature → signature changes → heal runs again and repositions.
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "C", cluster: "DATA", status: "PENDING", x: 9000, y: 9000 });
    await healRoadmapLayout();
    const c1 = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "C") });
    if (!c1) throw new Error("not found");
    // C moved off its stale (9000,9000) seed into the laid-out cloud.
    expect(c1.x === 9000 && c1.y === 9000).toBe(false);
    // and the board stays compact (no card flung absurdly far from B).
    const b2 = await nodeById(b.id);
    expect(Math.abs(b2.x)).toBeLessThan(5000);
  });
});
