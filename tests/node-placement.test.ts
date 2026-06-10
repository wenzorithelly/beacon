import { describe, expect, it } from "bun:test";
import { placeInGroup, placeWithoutOverlap } from "@/lib/node-placement";

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

describe("placeInGroup", () => {
  const noOverlap = (p: { x: number; y: number }, all: { x: number; y: number }[]) =>
    all.every((e) => Math.abs(e.x - p.x) >= 200 || Math.abs(e.y - p.y) >= 150);

  it("an empty board starts the first group at the origin", () => {
    expect(placeInGroup([], [])).toEqual({ x: 0, y: 0 });
  });

  it("a new group starts below everything on the board", () => {
    const others = [{ x: 0, y: 0 }, { x: 320, y: 150 }];
    const p = placeInGroup([], others);
    expect(p.y).toBeGreaterThan(150);
    expect(noOverlap(p, others)).toBe(true);
  });

  it("drops into the group's shortest column", () => {
    // col 0 has two cards (bottom 150), col 1 has one (bottom 0) → col 1 wins.
    const members = [{ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 320, y: 0 }];
    const p = placeInGroup(members, members);
    expect(p.x).toBe(320);
    expect(p.y).toBe(150);
  });

  it("opens a new column when the group is a square-ish block wanting to grow wide", () => {
    // 3 members all in col 0 → ceil(sqrt(4)) = 2 columns available; col 1 empty → wins at group top.
    const members = [{ x: 100, y: 0 }, { x: 100, y: 150 }, { x: 100, y: 300 }];
    const p = placeInGroup(members, members);
    expect(p.x).toBe(420); // minX + 1*colW
    expect(p.y).toBe(0);
  });

  it("never lands on an existing node (board-wide safety net)", () => {
    const members = [{ x: 0, y: 0 }];
    const intruder = { x: 0, y: 150 }; // another group's card sitting in our column
    const p = placeInGroup(members, [...members, intruder]);
    expect(noOverlap(p, [...members, intruder])).toBe(true);
  });

  it("is deterministic", () => {
    const members = [{ x: 0, y: 0 }, { x: 320, y: 0 }];
    expect(placeInGroup(members, members)).toEqual(placeInGroup(members, members));
  });
});
