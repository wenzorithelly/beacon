import { describe, expect, it } from "bun:test";
import { placeWithoutOverlap } from "@/lib/node-placement";

describe("placeWithoutOverlap", () => {
  it("returns the desired position when there's nothing there", () => {
    expect(placeWithoutOverlap([], { x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
  });

  it("keeps the desired position when far from every node", () => {
    expect(placeWithoutOverlap([{ x: 0, y: 0 }], { x: 600, y: 0 })).toEqual({ x: 600, y: 0 });
  });

  it("does NOT flag a normal grid row (one step over, same y) as an overlap", () => {
    expect(placeWithoutOverlap([{ x: 0, y: 200 }], { x: 240, y: 200 })).toEqual({ x: 240, y: 200 });
  });

  it("pushes a node straight down (preserving x) when it lands on an existing one", () => {
    const p = placeWithoutOverlap([{ x: 100, y: 100 }], { x: 100, y: 100 });
    expect(p.x).toBe(100);
    expect(p.y).toBeGreaterThan(100);
    expect(Math.abs(p.y - 100)).toBeGreaterThanOrEqual(150);
  });

  it("finds a clear slot below a vertical stack", () => {
    const stack = [{ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 0, y: 300 }];
    const p = placeWithoutOverlap(stack, { x: 0, y: 0 });
    const collides = stack.some((e) => Math.abs(e.x - p.x) < 200 && Math.abs(e.y - p.y) < 150);
    expect(collides).toBe(false);
  });
});
