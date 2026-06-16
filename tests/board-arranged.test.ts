import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// The board-layout-state file ensureBoardArranged reads/writes lives in the workspace data
// dir — isolate it.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-board-arrange-"));

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { node } from "@/lib/drizzle/schema";
import { resetDb } from "./helpers";
import { ensureBoardArranged } from "@/lib/map-ops";
import { BOARD_ALGO_VERSIONS, readBoardLayout, writeBoardLayout } from "@/lib/board-layout-state";

beforeEach(async () => {
  await resetDb();
  // Each test starts with no one-shot recorded.
  writeBoardLayout("roadmap", { sig: null, arrangedBy: null });
  writeBoardLayout("architecture", { sig: null });
});

async function nodeById(id: string) {
  const r = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.id, id) });
  if (!r) throw new Error("not found");
  return r;
}

// Organized by default: the one-shot arrange groups a never-arranged board, records the algo
// sig, and after that NEVER auto-moves the user's cards again — not on refresh, not on
// structural change. Only an algo-version bump re-tidies (once).
describe("ensureBoardArranged", () => {
  it("groups a scattered roadmap into theme lanes and records the sig", async () => {
    const mk = (title: string, cluster: string, x: number) =>
      db
        .insert(node)
        .values({ view: "ROADMAP", title, cluster, status: "PENDING", x, y: 0 })
        .returning();
    const [a] = await mk("A1", "DATA", 3000);
    const [a2] = await mk("A2", "DATA", -2000);
    const [b] = await mk("B1", "UI", 900);

    await ensureBoardArranged("ROADMAP");

    const [pa, pa2, pb] = await Promise.all([nodeById(a.id), nodeById(a2.id), nodeById(b.id)]);
    // Same-theme cards sit in one lane block (close together); the other theme is separate.
    const dSame = Math.hypot(pa.x - pa2.x, pa.y - pa2.y);
    const dOther = Math.min(
      Math.hypot(pa.x - pb.x, pa.y - pb.y),
      Math.hypot(pa2.x - pb.x, pa2.y - pb.y),
    );
    expect(dSame).toBeLessThan(dOther);
    expect(readBoardLayout("roadmap")).toEqual({
      sig: BOARD_ALGO_VERSIONS.roadmap,
      arrangedBy: "cluster",
      collapsed: [],
    });
  });

  it("a second call never moves cards (one-shot per algo version)", async () => {
    const [a] = await db
      .insert(node)
      .values({ view: "ROADMAP", title: "A", cluster: "DATA", status: "PENDING", x: 0, y: 0 })
      .returning();
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "B", cluster: "UI", status: "PENDING", x: 500, y: 0 });
    await ensureBoardArranged("ROADMAP");
    // The user drags a card somewhere deliberate…
    await db.update(node).set({ x: 12345, y: 678 }).where(eq(node.id, a.id));
    // …and a structural change happens (new feature) + another load.
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "C", cluster: "DATA", status: "PENDING", x: 0, y: 0 });
    await ensureBoardArranged("ROADMAP");
    const after = await nodeById(a.id);
    expect({ x: after.x, y: after.y }).toEqual({ x: 12345, y: 678 });
  });

  it("respects a stored arrangedBy dimension for the one-shot", async () => {
    writeBoardLayout("roadmap", { arrangedBy: "status" });
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "A", cluster: "DATA", status: "DONE", x: 0, y: 0 });
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "B", cluster: "DATA", status: "PENDING", x: 10, y: 0 });
    await ensureBoardArranged("ROADMAP");
    expect(readBoardLayout("roadmap").arrangedBy).toBe("status");
  });

  it("groups the architecture board by domain and records its sig", async () => {
    const mk = (title: string, cluster: string, x: number) =>
      db
        .insert(node)
        .values({ view: "ARCHITECTURE", title, cluster, status: "KEEP", x, y: 0 })
        .returning();
    const [a] = await mk("Comp A", "DATA", 5000);
    const [a2] = await mk("Comp A2", "DATA", -3000);
    const [b] = await mk("Comp B", "MCP", 1000);
    await ensureBoardArranged("ARCHITECTURE");
    const [pa, pa2, pb] = await Promise.all([nodeById(a.id), nodeById(a2.id), nodeById(b.id)]);
    expect(Math.hypot(pa.x - pa2.x, pa.y - pa2.y)).toBeLessThan(
      Math.hypot(pa.x - pb.x, pa.y - pb.y),
    );
    expect(readBoardLayout("architecture").sig).toBe(BOARD_ALGO_VERSIONS.architecture);
  });

  it("skips boards with fewer than two cards without burning the one-shot", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "Only", cluster: "DATA", status: "PENDING", x: 7, y: 7 });
    await ensureBoardArranged("ROADMAP");
    expect(readBoardLayout("roadmap").sig).toBeNull(); // still pending its first real arrange
    const only = await db.query.node.findFirst({ where: (t, { eq }) => eq(t.title, "Only") });
    expect({ x: only!.x, y: only!.y }).toEqual({ x: 7, y: 7 });
  });

  it("DRAFT nodes are ignored by the arrange", async () => {
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "A", cluster: "DATA", status: "PENDING", x: 0, y: 0 });
    await db
      .insert(node)
      .values({ view: "ROADMAP", title: "B", cluster: "UI", status: "PENDING", x: 10, y: 0 });
    const [draft] = await db
      .insert(node)
      .values({
        view: "ROADMAP",
        title: "Draft",
        cluster: "DATA",
        status: "PENDING",
        source: "DRAFT",
        x: 9999,
        y: 9999,
      })
      .returning();
    await ensureBoardArranged("ROADMAP");
    const d = await nodeById(draft.id);
    expect({ x: d.x, y: d.y }).toEqual({ x: 9999, y: 9999 });
  });
});
