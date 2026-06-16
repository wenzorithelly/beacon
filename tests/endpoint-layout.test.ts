import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-layout-"));

import { db } from "@/lib/db";
import { endpointTable, endpoint, dbColumn, dbRelation, dbTable } from "@/lib/drizzle/schema";
import { computeDraftOriginY, endpointsOverlap } from "@/lib/endpoint-layout";
import { graphToDoc } from "@/lib/draft-store";
import type { DraftGraph } from "@/lib/design";

const ep = (method: string, path: string, y: number) =>
  db.insert(endpoint).values({ method, path, source: "INTROSPECTION", x: -460, y });

describe("endpoint layout helpers", () => {
  beforeEach(async () => {
    await db.delete(endpointTable);
    await db.delete(endpoint);
    await db.delete(dbColumn);
    await db.delete(dbRelation);
    await db.delete(dbTable);
  });

  it("endpointsOverlap flags stacked pills and passes a clean grid", () => {
    expect(
      endpointsOverlap([
        { x: 0, y: 100 },
        { x: 10, y: 110 },
      ]),
    ).toBe(true);
    expect(
      endpointsOverlap([
        { x: 0, y: 0 },
        { x: 0, y: 60 },
        { x: 300, y: 0 },
      ]),
    ).toBe(false);
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
});
