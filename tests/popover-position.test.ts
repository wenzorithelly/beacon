import { describe, expect, it } from "bun:test";
import { clampToViewport } from "@/lib/popover-position";

// The /plan annotation popover + comment composer anchor at the text selection and would fly
// off-screen for selections near an edge or spanning many lines. clampToViewport keeps the
// w×h floating box fully inside the viewport (with a margin).
describe("clampToViewport", () => {
  const VW = 1000;
  const VH = 800;
  const W = 256; // composer width (w-64)
  const H = 120;

  it("leaves a box that already fits unchanged", () => {
    expect(clampToViewport(300, 200, W, H, VW, VH)).toEqual({ left: 300, top: 200 });
  });

  it("pulls a box overflowing the right edge back in (with margin)", () => {
    // x near the right edge — the 256px box would overflow.
    expect(clampToViewport(900, 200, W, H, VW, VH, 8)).toEqual({ left: VW - W - 8, top: 200 });
  });

  it("pulls a box overflowing the bottom edge back in", () => {
    expect(clampToViewport(300, 760, W, H, VW, VH, 8)).toEqual({ left: 300, top: VH - H - 8 });
  });

  it("clamps negative coordinates to the margin", () => {
    expect(clampToViewport(-50, -20, W, H, VW, VH, 8)).toEqual({ left: 8, top: 8 });
  });

  it("falls back to the margin when the box is wider than the viewport", () => {
    expect(clampToViewport(500, 100, 2000, H, VW, VH, 8)).toEqual({ left: 8, top: 100 });
  });
});
