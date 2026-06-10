import { describe, expect, it } from "bun:test";
import { computeBoardLayout } from "@/lib/board-arrange";
import { estimateTableHeight } from "@/lib/table-layout";

// Explicit "Arrange board": pack tables into a width-scaled masonry and the endpoint grid
// beside it, height-matched — a wide, shallow board instead of a tall scroll.

const tables = Array.from({ length: 24 }, (_, i) => ({
  id: `t${i}`,
  columnCount: 4 + (i % 7),
}));
const endpoints = Array.from({ length: 68 }, (_, i) => ({
  id: `e${i}`,
  method: i % 2 ? "GET" : "POST",
  path: `/api/${String.fromCharCode(97 + (i % 9))}/${i}`,
}));

describe("computeBoardLayout", () => {
  const layout = computeBoardLayout(tables, endpoints);

  it("positions every table and endpoint", () => {
    expect(layout.tables.size).toBe(24);
    expect(layout.endpoints.size).toBe(68);
  });

  it("uses more than 4 table columns for a big schema (width over height)", () => {
    const xs = new Set([...layout.tables.values()].map((p) => p.x));
    expect(xs.size).toBeGreaterThan(4);
  });

  it("keeps the endpoint block beside the tables, not below them", () => {
    const tableBottom = Math.max(
      ...tables.map((t) => layout.tables.get(t.id)!.y + estimateTableHeight(t.columnCount)),
    );
    const epBottom = Math.max(...[...layout.endpoints.values()].map((p) => p.y + 50));
    // The endpoint grid is height-matched to the table block (within one row of slack).
    expect(epBottom).toBeLessThanOrEqual(tableBottom + 120);
    // And entirely in the left gutter (negative x).
    for (const p of layout.endpoints.values()) expect(p.x).toBeLessThan(0);
  });

  it("no two endpoints share a slot", () => {
    const seen = new Set<string>();
    for (const p of layout.endpoints.values()) {
      const key = `${p.x}:${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("is deterministic", () => {
    const again = computeBoardLayout(tables, endpoints);
    expect([...again.tables.entries()]).toEqual([...layout.tables.entries()]);
    expect([...again.endpoints.entries()]).toEqual([...layout.endpoints.entries()]);
  });
});
