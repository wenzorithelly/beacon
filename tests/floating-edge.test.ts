import { describe, expect, it } from "bun:test";
import { rectBorderPointToward } from "@/components/graph/floating-edge";

// Geometry for the annotation connector's floating target: the line leaves the pin (a fixed
// source) and lands on the point of the card's border nearest the pin, recomputed as the card
// moves. rectBorderPointToward returns where a ray from the rect's center toward `from` exits.

const r = { x: 0, y: 0, w: 100, h: 80 }; // center (50, 40)

describe("rectBorderPointToward", () => {
  it("exits the right edge for a point to the right", () => {
    expect(rectBorderPointToward(r, { x: 500, y: 40 })).toEqual({ x: 100, y: 40 });
  });

  it("exits the left edge for a point to the left", () => {
    expect(rectBorderPointToward(r, { x: -500, y: 40 })).toEqual({ x: 0, y: 40 });
  });

  it("exits the bottom edge for a point below", () => {
    expect(rectBorderPointToward(r, { x: 50, y: 500 })).toEqual({ x: 50, y: 80 });
  });

  it("exits the top edge for a point above", () => {
    expect(rectBorderPointToward(r, { x: 50, y: -500 })).toEqual({ x: 50, y: 0 });
  });

  it("lands on a border (never outside the rect) for a diagonal point", () => {
    const p = rectBorderPointToward(r, { x: 1000, y: 1000 });
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThanOrEqual(100);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThanOrEqual(80);
    // touches at least one edge
    expect(p.x === 100 || p.y === 80).toBe(true);
  });

  it("returns the center when the source coincides with it", () => {
    expect(rectBorderPointToward(r, { x: 50, y: 40 })).toEqual({ x: 50, y: 40 });
  });
});
