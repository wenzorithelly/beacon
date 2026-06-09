import { describe, expect, it } from "bun:test";
import { layoutArchitectureByDomain, layoutByGroup } from "@/lib/architecture-layout";

describe("layoutByGroup", () => {
  it("orders lanes by an explicit groupOrder, present groups only", () => {
    const items = [
      { id: "a", k: "PENDING" },
      { id: "b", k: "IN_PROGRESS" },
      { id: "c", k: "DONE" },
    ];
    const pos = layoutByGroup(items, (it) => it.k, {
      colW: 100,
      groupOrder: ["IN_PROGRESS", "PENDING", "MISSING", "DONE"],
    });
    expect(pos.get(items[1])!.x).toBe(0); // IN_PROGRESS first
    expect(pos.get(items[0])!.x).toBe(100); // PENDING second (MISSING skipped — not present)
    expect(pos.get(items[2])!.x).toBe(200); // DONE third
  });

  it("appends groups not listed in groupOrder, alphabetically, after the listed ones", () => {
    const items = [
      { id: "z", k: "ZED" },
      { id: "a", k: "ABLE" },
      { id: "p", k: "PENDING" },
    ];
    const pos = layoutByGroup(items, (it) => it.k, { colW: 100, groupOrder: ["PENDING"] });
    expect(pos.get(items[2])!.x).toBe(0); // PENDING (listed) first
    expect(pos.get(items[1])!.x).toBe(100); // ABLE (unlisted, alphabetical)
    expect(pos.get(items[0])!.x).toBe(200); // ZED (unlisted, alphabetical)
  });

  it("reserves extra row-slots per item via weightFn so heavy items don't overlap", () => {
    const items = [
      { id: "p1", k: "X", weight: 3 }, // consumes 3 row-slots
      { id: "p2", k: "X", weight: 1 },
    ];
    const pos = layoutByGroup(items, (it) => it.k, {
      rowH: 100,
      weightFn: (it) => (it as { weight: number }).weight,
    });
    expect(pos.get(items[0])).toEqual({ x: 0, y: 0 });
    expect(pos.get(items[1])).toEqual({ x: 0, y: 300 }); // starts after p1's 3 slots
  });
});

describe("layoutArchitectureByDomain", () => {
  it("stacks components of the same domain in one column", () => {
    const items = [
      { domain: "DATA", id: "a" },
      { domain: "DATA", id: "b" },
      { domain: "DATA", id: "c" },
    ];
    const pos = layoutArchitectureByDomain(items, { colW: 320, rowH: 150 });
    expect(pos.get(items[0])).toEqual({ x: 0, y: 0 });
    expect(pos.get(items[1])).toEqual({ x: 0, y: 150 });
    expect(pos.get(items[2])).toEqual({ x: 0, y: 300 });
  });

  it("places distinct domains in adjacent columns (first-seen order)", () => {
    const items = [
      { domain: "MCP", id: "m" },
      { domain: "DATA", id: "d" },
      { domain: "UI", id: "u" },
    ];
    const pos = layoutArchitectureByDomain(items, { colW: 320 });
    expect(pos.get(items[0])!.x).toBe(0); // MCP
    expect(pos.get(items[1])!.x).toBe(320); // DATA
    expect(pos.get(items[2])!.x).toBe(640); // UI
    expect(pos.get(items[0])!.y).toBe(0);
  });

  it("wraps domains into a new band after perBand columns, clearing the tallest column", () => {
    const items = [
      { domain: "A", id: "a1" },
      { domain: "A", id: "a2" }, // A has 2 → band height = 2*rowH
      { domain: "B", id: "b1" },
      { domain: "C", id: "c1" }, // C is the 3rd domain → wraps to band 2
    ];
    const pos = layoutArchitectureByDomain(items, { colW: 320, rowH: 150, perBand: 2, bandGap: 90 });
    // Band 1: A (col 0), B (col 1)
    expect(pos.get(items[0])).toEqual({ x: 0, y: 0 });
    expect(pos.get(items[1])).toEqual({ x: 0, y: 150 });
    expect(pos.get(items[2])).toEqual({ x: 320, y: 0 });
    // Band 2 starts below the tallest column of band 1 (2 rows) + bandGap = 2*150 + 90 = 390
    expect(pos.get(items[3])).toEqual({ x: 0, y: 390 });
  });

  it("collapses null/empty domains into one group without throwing", () => {
    const items = [{ domain: null, id: "x" }, { domain: "", id: "y" }];
    const pos = layoutArchitectureByDomain(items, { rowH: 150 });
    expect(pos.get(items[0])).toEqual({ x: 0, y: 0 });
    expect(pos.get(items[1])).toEqual({ x: 0, y: 150 });
  });
});
