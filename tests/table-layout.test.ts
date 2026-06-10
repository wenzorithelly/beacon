import { describe, expect, it } from "bun:test";
import {
  TABLE_COL_COUNT,
  TABLE_COL_WIDTH,
  TABLE_GAP_PX,
  estimateTableHeight,
  packTablesMasonry,
  tablesOverlap,
} from "@/lib/table-layout";
import { endpointsOverlap } from "@/lib/endpoint-layout";

describe("estimateTableHeight", () => {
  it("grows with the column count", () => {
    expect(estimateTableHeight(12)).toBeGreaterThan(estimateTableHeight(2));
  });

  it("returns a positive baseline even for an empty table", () => {
    expect(estimateTableHeight(0)).toBeGreaterThan(0);
  });
});

describe("packTablesMasonry", () => {
  it("places everything on the first row when there are at most TABLE_COL_COUNT tables", () => {
    const result = packTablesMasonry(
      Array.from({ length: TABLE_COL_COUNT }, (_, i) => ({
        key: `t${i}`,
        columnCount: 4,
      })),
    );
    for (let i = 0; i < TABLE_COL_COUNT; i++) {
      expect(result.get(`t${i}`)).toEqual({ x: i * TABLE_COL_WIDTH, y: 0 });
    }
  });

  it("never produces an overlap, even when tables have wildly different heights", () => {
    // Mirrors the actual Beacon schema (Node = 11 cols, DbColumn = 9, etc.) where the
    // old `floor(i/4) * 260` grid silently stacked Node onto its bottom neighbour.
    const cases = [
      { key: "AppSetting", columnCount: 6 },
      { key: "DbTable", columnCount: 9 },
      { key: "DbColumn", columnCount: 9 },
      { key: "DbRelation", columnCount: 6 },
      { key: "Endpoint", columnCount: 10 },
      { key: "EndpointTable", columnCount: 4 },
      { key: "Node", columnCount: 11 },
      { key: "Edge", columnCount: 5 },
      { key: "Bug", columnCount: 7 },
      { key: "Tag", columnCount: 2 },
      { key: "File", columnCount: 2 },
    ];
    const positions = packTablesMasonry(cases);
    const placed = cases.map((c) => ({
      ...positions.get(c.key)!,
      columnCount: c.columnCount,
    }));
    expect(tablesOverlap(placed)).toBe(false);
  });

  it("respects already-placed tables so we never land on a persisted neighbour", () => {
    const existing = [
      { x: 0, y: 0, columnCount: 11 }, // a tall table already in column 0
    ];
    const result = packTablesMasonry(
      [{ key: "new", columnCount: 3 }],
      existing,
    );
    const pos = result.get("new")!;
    // Column 0 is blocked by the tall table → new entry must land in 1/2/3.
    expect(pos.x).not.toBe(0);
    const all = [
      ...existing,
      { x: pos.x, y: pos.y, columnCount: 3 },
    ];
    expect(tablesOverlap(all)).toBe(false);
  });

  it("prefers the column with the lowest cumulative bottom", () => {
    // All four columns are occupied — column 2 has the shortest existing entry, so
    // the next table should land there (smallest cumulative bottom = most room).
    const existing = [
      { x: 0 * TABLE_COL_WIDTH, y: 0, columnCount: 12 },
      { x: 1 * TABLE_COL_WIDTH, y: 0, columnCount: 8 },
      { x: 2 * TABLE_COL_WIDTH, y: 0, columnCount: 2 },
      { x: 3 * TABLE_COL_WIDTH, y: 0, columnCount: 6 },
    ];
    const result = packTablesMasonry([{ key: "next", columnCount: 3 }], existing);
    expect(result.get("next")!.x).toBe(2 * TABLE_COL_WIDTH);
    expect(result.get("next")!.y).toBeGreaterThan(0);
  });
});

describe("tablesOverlap", () => {
  it("flags the old broken grid where tall tables stack on their neighbours", () => {
    // The pre-fix formula put Node (11 cols → ~382px tall) at y=0 and its bottom
    // neighbour at y=260: the bottom 122px of Node bled into the next row.
    expect(
      tablesOverlap([
        { x: 0, y: 0, columnCount: 11 },
        { x: 0, y: 260, columnCount: 6 },
      ]),
    ).toBe(true);
  });

  it("treats two tables in distinct columns as non-overlapping", () => {
    expect(
      tablesOverlap([
        { x: 0, y: 0, columnCount: 11 },
        { x: TABLE_COL_WIDTH, y: 0, columnCount: 11 },
      ]),
    ).toBe(false);
  });

  it("treats vertically separated tables in the same column as non-overlapping", () => {
    const h = estimateTableHeight(6);
    expect(
      tablesOverlap([
        { x: 0, y: 0, columnCount: 6 },
        { x: 0, y: h + TABLE_GAP_PX, columnCount: 6 },
      ]),
    ).toBe(false);
  });
});

describe("endpointsOverlap", () => {
  it("flags two endpoints stacked at the same spot", () => {
    expect(endpointsOverlap([{ x: -460, y: 100 }, { x: -460, y: 100 }])).toBe(true);
  });

  it("treats a docked column (one row pitch apart) as non-overlapping", () => {
    const positions = Array.from({ length: 30 }, (_, i) => ({
      x: (i % 3) * 280,
      y: Math.floor(i / 3) * 60,
    }));
    expect(endpointsOverlap(positions)).toBe(false);
  });
});
