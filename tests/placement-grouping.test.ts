import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// startFeature reads the board's persisted grouping from the workspace data dir — isolate it.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-placement-grouping-"));

import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { startFeature } from "@/lib/map-ops";
import { writeBoardLayout } from "@/lib/board-layout-state";

const DESC = "A fixture description long enough to clear the roadmap card body minimum length.";

// Two clusters, laid out so the CLUSTER lane and the STATUS/PRIORITY lane sit in regions far
// apart: whichever dimension the placement buckets by is obvious from where the card lands.
async function seed() {
  await db.insert(node).values([
    // DATA cards: done, P0, top-left region.
    { view: "ROADMAP", title: "Old A", cluster: "DATA", status: "DONE", priority: 0, x: 0, y: 0 },
    { view: "ROADMAP", title: "Old B", cluster: "DATA", status: "DONE", priority: 0, x: 320, y: 0 },
    // Other clusters: in progress, P3, far bottom-right region.
    { view: "ROADMAP", title: "Live C", cluster: "UI", status: "IN_PROGRESS", priority: 3, x: 3000, y: 3000 },
    { view: "ROADMAP", title: "Live D", cluster: "PLAT", status: "IN_PROGRESS", priority: 3, x: 3320, y: 3000 },
  ]);
}

async function nearestTitle(id: string): Promise<string> {
  const me = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, id) }))!;
  const others = (await db.query.node.findMany({ where: (t, { eq }) => eq(t.view, "ROADMAP") })).filter(
    (n) => n.id !== id,
  );
  return others.sort(
    (a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y),
  )[0].title;
}

beforeEach(async () => {
  await resetDb();
  writeBoardLayout("roadmap", { arrangedBy: null });
  await seed();
});

// A card the agent adds must join the lane the board is CURRENTLY grouped into. Bucketing new
// cards by cluster on a status- or priority-grouped board dropped them in the wrong lane, so the
// layout drifted a little further out of its grouping every session.
describe("agent-added cards respect the board's active grouping", () => {
  it("buckets by status when the board is grouped by status", async () => {
    writeBoardLayout("roadmap", { arrangedBy: "status" });
    // Cluster DATA (whose cards are top-left) but IN_PROGRESS (whose cards are bottom-right).
    const r = await startFeature({ title: "Brand new zzz", cluster: "DATA", detail: DESC });
    expect(r.action).toBe("created");
    if (r.action !== "created") return;
    const n = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) }))!;
    expect(n.status).toBe("IN_PROGRESS");
    expect(n.x).toBeGreaterThan(2000);
    expect(await nearestTitle(r.id)).toMatch(/^Live /);
  });

  it("buckets by priority when the board is grouped by priority", async () => {
    writeBoardLayout("roadmap", { arrangedBy: "priority" });
    const r = await startFeature({
      title: "Brand new zzz",
      cluster: "DATA",
      priority: 3,
      status: "backlog",
      detail: DESC,
    });
    expect(r.action).toBe("created");
    if (r.action !== "created") return;
    const n = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) }))!;
    expect(n.x).toBeGreaterThan(2000);
    expect(await nearestTitle(r.id)).toMatch(/^Live /);
  });

  it("falls back to the theme cluster when the board has no recorded grouping", async () => {
    const r = await startFeature({ title: "Brand new zzz", cluster: "DATA", detail: DESC });
    expect(r.action).toBe("created");
    if (r.action !== "created") return;
    const n = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) }))!;
    expect(n.x).toBeLessThan(1000);
    expect(await nearestTitle(r.id)).toMatch(/^Old /);
  });

  // A sub-task belongs under its PARENT in every grouping — the lane follows the parent. It used
  // to be placed at an absolute y (160 + siblings*110), so a child of a far-down card landed at
  // the top of the board instead of beneath its parent.
  it("stacks a sub-task under its parent wherever the parent sits", async () => {
    writeBoardLayout("roadmap", { arrangedBy: "status" });
    const r = await startFeature({
      title: "Nested task zzz",
      cluster: "UI",
      front: "Live C",
      detail: DESC,
    });
    expect(r.action).toBe("created");
    if (r.action !== "created") return;
    const n = (await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, r.id) }))!;
    expect(n.parentId).toBeTruthy();
    expect({ x: n.x, y: n.y }).toEqual({ x: 3000, y: 3160 });
    expect(await nearestTitle(r.id)).toBe("Live C");
  });
});
