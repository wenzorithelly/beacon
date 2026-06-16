import { describe, expect, it } from "bun:test";
import {
  clampViewportAspect,
  flowBlocksIntoBands,
  viewportBandWidth,
  type FlowBlock,
} from "@/lib/band-flow";

// The shared band-flow used by every band board (roadmap, architecture, database): flow variable-
// size blocks left→right, wrapping into bands at a width derived from the reviewer's VIEWPORT, so a
// wide screen lays out wider (fewer, shorter bands → less vertical scroll) and a narrow one taller.

const opts = (extra: Partial<Parameters<typeof flowBlocksIntoBands>[1]> = {}) => ({
  gapX: 20,
  gapY: 20,
  minBandW: 100,
  ...extra,
});

describe("clampViewportAspect", () => {
  it("passes a sane aspect through", () => {
    expect(clampViewportAspect(1.78)).toBe(1.78);
  });
  it("clamps extremes and falls back for invalid input", () => {
    expect(clampViewportAspect(99)).toBe(3.2);
    expect(clampViewportAspect(0.1)).toBe(0.7);
    expect(clampViewportAspect(undefined)).toBe(1.8);
    expect(clampViewportAspect(0)).toBe(1.8);
    expect(clampViewportAspect(NaN)).toBe(1.8);
  });
});

describe("viewportBandWidth", () => {
  const blocks: FlowBlock[] = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, w: 300, h: 300 }));

  it("makes a wider viewport produce a wider band (fewer, shorter bands)", () => {
    const wide = viewportBandWidth(blocks, opts({ viewportAspect: 2.4 }));
    const narrow = viewportBandWidth(blocks, opts({ viewportAspect: 0.8 }));
    expect(wide).toBeGreaterThan(narrow);
  });

  it("never returns less than minBandW", () => {
    expect(viewportBandWidth([{ id: "a", w: 10, h: 10 }], opts({ minBandW: 500 }))).toBe(500);
  });
});

describe("flowBlocksIntoBands", () => {
  it("flows blocks left→right then wraps to a new band past the band width", () => {
    // 4 blocks of 300w with 20 gap; force a narrow band so they wrap.
    const blocks: FlowBlock[] = Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, w: 300, h: 100 }));
    const origins = flowBlocksIntoBands(blocks, opts({ viewportAspect: 0.7, minBandW: 700 }));
    // band width 700 fits 2 blocks (300+20+300=620, +300 overflows) → 2 per band, 2 bands.
    expect(origins.get("b0")).toEqual({ x: 0, y: 0 });
    expect(origins.get("b1")).toEqual({ x: 320, y: 0 });
    expect(origins.get("b2")!.x).toBe(0); // wrapped
    expect(origins.get("b2")!.y).toBeGreaterThan(0);
  });

  it("a wide viewport keeps more blocks on one band than a narrow one", () => {
    const blocks: FlowBlock[] = Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, w: 300, h: 200 }));
    const bandsAt = (aspect: number) => {
      const origins = flowBlocksIntoBands(blocks, opts({ viewportAspect: aspect }));
      return new Set([...origins.values()].map((p) => p.y)).size; // distinct band tops = band count
    };
    expect(bandsAt(2.6)).toBeLessThanOrEqual(bandsAt(0.7));
  });

  it("is deterministic", () => {
    const blocks: FlowBlock[] = [
      { id: "a", w: 200, h: 100 },
      { id: "b", w: 400, h: 300 },
      { id: "c", w: 100, h: 100 },
    ];
    expect(flowBlocksIntoBands(blocks, opts({ viewportAspect: 1.8 }))).toEqual(
      flowBlocksIntoBands(blocks, opts({ viewportAspect: 1.8 })),
    );
  });
});
