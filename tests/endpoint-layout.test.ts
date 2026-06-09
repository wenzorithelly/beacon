import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-layout-"));

import { db } from "@/lib/db";
import { endpointTable, endpoint, dbColumn, dbRelation, dbTable } from "@/lib/drizzle/schema";
import { relayoutEndpoints, computeDraftOriginY } from "@/lib/endpoint-layout";
import { graphToDoc } from "@/lib/draft-store";
import type { DraftGraph } from "@/lib/design";

const ep = (method: string, path: string, y: number) =>
  db.insert(endpoint).values({ method, path, source: "INTROSPECTION", x: -460, y });

describe("relayoutEndpoints (un-stack overlapping endpoint nodes)", () => {
  beforeEach(async () => {
    await db.delete(endpointTable);
    await db.delete(endpoint);
    await db.delete(dbColumn);
    await db.delete(dbRelation);
    await db.delete(dbTable);
  });

  it("re-spreads endpoints stacked at the same y into the grid", async () => {
    await ep("GET", "/lay/a", 100); // 3 stacked at y=100
    await ep("POST", "/lay/b", 100);
    await ep("DELETE", "/lay/c", 100);
    await ep("GET", "/lay/d", 220); // a fourth at y=220

    const moved = await relayoutEndpoints();
    expect(moved).toBeGreaterThanOrEqual(3);

    const eps = await db.query.endpoint.findMany();
    const seen = new Set(eps.map((e) => `${e.x}:${e.y}`));
    expect(seen.size).toBe(eps.length); // no two endpoints share a cell
    for (const e of eps) {
      expect(e.y).toBeGreaterThanOrEqual(0);
      expect(e.x).toBeLessThan(0); // still left of the table gutter
    }
  });

  it("computeDraftOriginY returns 0 on an empty canvas, max-y + margin otherwise", async () => {
    expect(await computeDraftOriginY()).toBe(0);
    await db.insert(dbTable).values({ name: "co_origin_tbl", x: 0, y: 500, source: "MANUAL" });
    await ep("GET", "/co/origin/ep", 800);
    const origin = await computeDraftOriginY();
    expect(origin).toBeGreaterThan(800); // strictly below the lowest existing thing
  });

  it("graphToDoc shifts drafted tables AND endpoints below an origin so they don't overlap existing nodes", () => {
    const g: DraftGraph = {
      tables: [{ name: "draft_a", domain: null, description: null, columns: [] }],
      relations: [],
      endpoints: [{ method: "GET", path: "/draft/a", domain: null, description: null, uses: [] }],
    };
    const shifted = graphToDoc(g, 0, 1200);
    expect(shifted.tables[0].y).toBe(1200); // (0 % 4)*320 = 0, idx 0 row 0 → 0 + 1200
    expect(shifted.endpoints[0].y).toBeGreaterThanOrEqual(1200);
    // Default (no origin) still works the same as before — tables start at y=0.
    const unshifted = graphToDoc(g, 0);
    expect(unshifted.tables[0].y).toBe(0);
  });

  it("is idempotent — running twice doesn't shift anything that's already laid out cleanly", async () => {
    await ep("GET", "/idem/a", 100);
    await ep("GET", "/idem/b", 100);
    await relayoutEndpoints();
    const before = await db.query.endpoint.findMany({ orderBy: (e, { asc }) => asc(e.id) });
    await relayoutEndpoints();
    const after = await db.query.endpoint.findMany({ orderBy: (e, { asc }) => asc(e.id) });
    for (let i = 0; i < before.length; i++) expect(after[i].y).toBe(before[i].y);
  });
});
