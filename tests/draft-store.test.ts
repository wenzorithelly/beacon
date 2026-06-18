import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// graphToDoc is pure, but the module imports the db layer — point BEACON_HOME at a throwaway dir.
process.env.BEACON_HOME = mkdtempSync(join(tmpdir(), "beacon-draft-"));

import type { RegionInput } from "@/lib/group-regions";

const { graphToDoc } = await import("@/lib/draft-store");
const { computeGroupRegions } = await import("@/lib/group-regions");
const { estimateTableHeight, TABLE_COL_WIDTH } = await import("@/lib/db-board-layout");
const { draftSchema } = await import("@/lib/design");

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

describe("graphToDoc — domain-clustered draft layout", () => {
  const graph = draftSchema.parse({
    tables: [
      {
        name: "change_reports",
        domain: "MONITOR",
        columns: ["id uuid", "user_id uuid", "report_type text", "created_at timestamp"],
      },
      {
        name: "document_versions",
        domain: "DATA",
        columns: ["id uuid", "document_id uuid", "version_number integer", "status text"],
      },
    ],
    relations: [],
    endpoints: [
      { method: "POST", path: "/api/v1/reports", uses: [{ table: "change_reports" }] },
      { method: "GET", path: "/api/v1/versions", uses: [{ table: "document_versions" }] },
    ],
  });

  it("separates the two domain regions so their labels don't collide", () => {
    const doc = graphToDoc(graph, 1);
    const items: RegionInput[] = doc.tables.map((t) => ({
      id: t.id,
      group: t.domain ?? "—",
      x: t.x,
      y: t.y,
      w: TABLE_COL_WIDTH,
      h: estimateTableHeight(t.columns.length),
    }));
    const regions = computeGroupRegions(items);
    expect(regions).toHaveLength(2); // MONITOR + DATA
    expect(overlaps(regions[0], regions[1])).toBe(false);
  });

  it("docks each endpoint below its primary table (not floating in a detached grid)", () => {
    const doc = graphToDoc(graph, 1);
    const byName = new Map(doc.tables.map((t) => [t.name, t]));
    for (const ep of doc.endpoints) {
      const tableId = ep.links[0]?.tableId;
      const table = doc.tables.find((t) => t.id === tableId)!;
      expect(table).toBeDefined();
      // Endpoint sits beneath its table's body and shares its left edge (docked).
      expect(ep.y).toBeGreaterThanOrEqual(table.y + estimateTableHeight(table.columns.length));
      expect(ep.x).toBe(table.x);
    }
    void byName;
  });
});

describe("graphToDoc — inherits omitted column attrs from the live schema", () => {
  // A re-declared existing table: from_sequence is NOT NULL + an FK in the live schema.
  const real = [
    {
      name: "merkle_roots",
      columns: [
        { name: "from_sequence", type: "bigint", isPk: false, isFk: true, nullable: false },
        { name: "root_hash", type: "varchar(64)", isPk: false, isFk: false, nullable: false },
      ],
    },
  ];

  it("fills unspecified nullable/isFk from the matching live column (no phantom change)", () => {
    const graph = draftSchema.parse({
      tables: [
        {
          name: "merkle_roots",
          // The agent re-declares the table to hang a constraint off it, omitting nullable/isFk.
          columns: [
            { name: "from_sequence", type: "bigint" },
            { name: "root_hash", type: "varchar(64)" },
          ],
        },
      ],
      relations: [],
      endpoints: [],
    });
    const doc = graphToDoc(graph, 1, 0, real);
    const cols = new Map(doc.tables[0].columns.map((c) => [c.name, c]));
    expect(cols.get("from_sequence")).toMatchObject({ nullable: false, isFk: true });
    expect(cols.get("root_hash")).toMatchObject({ nullable: false, isFk: false });
  });

  it("lets an explicitly-stated attr override the live value", () => {
    const graph = draftSchema.parse({
      tables: [{ name: "merkle_roots", columns: [{ name: "from_sequence", type: "bigint", nullable: true }] }],
      relations: [],
      endpoints: [],
    });
    const doc = graphToDoc(graph, 1, 0, real);
    expect(doc.tables[0].columns[0].nullable).toBe(true);
  });

  it("falls back to hard defaults with no live match, and when realTables is omitted entirely", () => {
    const graph = draftSchema.parse({
      tables: [{ name: "brand_new", columns: [{ name: "id", type: "uuid" }] }],
      relations: [],
      endpoints: [],
    });
    const withReal = graphToDoc(graph, 1, 0, real); // "brand_new" has no live match
    const withoutReal = graphToDoc(graph, 1);
    expect(withReal.tables[0].columns[0]).toMatchObject({ nullable: true, isPk: false, isFk: false });
    expect(withoutReal.tables[0].columns[0]).toMatchObject({ nullable: true, isPk: false, isFk: false });
  });
});
