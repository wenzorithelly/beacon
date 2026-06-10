import { describe, expect, it } from "bun:test";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";

const item = (id: string, group: string, x: number, y: number, w = 256, h = 96): RegionInput => ({
  id,
  group,
  x,
  y,
  w,
  h,
});

describe("computeGroupRegions", () => {
  it("returns one region per group wrapping its members (pad + header)", () => {
    const regions = computeGroupRegions([
      item("a", "DATA", 0, 0),
      item("b", "DATA", 320, 150),
      item("c", "UI", 1000, 0),
    ]);
    expect(regions).toHaveLength(2);
    const data = regions.find((r) => r.key === "DATA")!;
    // bbox: x 0..576, y 0..246 → pad 20, header 26
    expect(data.x).toBe(-20);
    expect(data.y).toBe(-46);
    expect(data.w).toBe(576 + 40);
    expect(data.h).toBe(246 + 40 + 26);
    expect(data.count).toBe(2);
    const ui = regions.find((r) => r.key === "UI")!;
    expect(ui.count).toBe(1);
  });

  it("regions of spatially separated groups do not overlap", () => {
    const regions = computeGroupRegions([
      item("a", "A", 0, 0),
      item("b", "A", 0, 150),
      item("c", "B", 800, 0),
      item("d", "B", 800, 150),
    ]);
    const [ra, rb] = regions;
    const overlap = ra.x < rb.x + rb.w && rb.x < ra.x + ra.w && ra.y < rb.y + rb.h && rb.y < ra.y + ra.h;
    expect(overlap).toBe(false);
  });

  it("is deterministic and sorted by key regardless of input order", () => {
    const a = computeGroupRegions([item("a", "Z", 0, 0), item("b", "A", 500, 0)]);
    const b = computeGroupRegions([item("b", "A", 500, 0), item("a", "Z", 0, 0)]);
    expect(a).toEqual(b);
    expect(a.map((r) => r.key)).toEqual(["A", "Z"]);
  });

  it("returns [] for no items and honors custom pad/header", () => {
    expect(computeGroupRegions([])).toEqual([]);
    const [r] = computeGroupRegions([item("a", "X", 100, 100)], { pad: 10, header: 0 });
    expect(r.x).toBe(90);
    expect(r.y).toBe(90);
    expect(r.w).toBe(256 + 20);
    expect(r.h).toBe(96 + 20);
  });
});
