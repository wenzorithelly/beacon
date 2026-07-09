import { describe, expect, it } from "bun:test";
import {
  classifyDragEnd,
  isBeyondBottomEdge,
  isWithinBottomZone,
  MOVE_THROTTLE_MS,
  NEAR_BOTTOM_PX,
  shouldEmitMove,
} from "@/lib/shell-node-drag";

// Pure decision logic behind the desktop-shell "sticky terminal" node-drag handoff: how close to
// the bottom edge counts as "near" (lights up the band), the move-event throttle gate, and whether
// a drag-stop reads as a shell drop ("end") or a plain in-canvas release ("cancel").

describe("isWithinBottomZone", () => {
  it("is false well above the threshold", () => {
    expect(isWithinBottomZone(200, 800)).toBe(false);
  });

  it("is true exactly at the threshold boundary", () => {
    expect(isWithinBottomZone(800 - NEAR_BOTTOM_PX, 800)).toBe(true);
  });

  it("is true inside the near-bottom band and below the viewport", () => {
    expect(isWithinBottomZone(750, 800)).toBe(true);
    expect(isWithinBottomZone(900, 800)).toBe(true);
  });

  it("honors a custom threshold", () => {
    expect(isWithinBottomZone(790, 800, 20)).toBe(true);
    expect(isWithinBottomZone(770, 800, 20)).toBe(false);
  });
});

describe("isBeyondBottomEdge", () => {
  it("is false above the viewport bottom, even within the near-bottom zone", () => {
    expect(isBeyondBottomEdge(750, 800)).toBe(false);
  });

  it("is true exactly at and past the viewport bottom", () => {
    expect(isBeyondBottomEdge(800, 800)).toBe(true);
    expect(isBeyondBottomEdge(850, 800)).toBe(true);
  });
});

describe("shouldEmitMove", () => {
  it("gates emits under the throttle interval", () => {
    expect(shouldEmitMove(1000, 1000 + MOVE_THROTTLE_MS - 1)).toBe(false);
  });

  it("allows an emit once the interval has elapsed", () => {
    expect(shouldEmitMove(1000, 1000 + MOVE_THROTTLE_MS)).toBe(true);
    expect(shouldEmitMove(1000, 1000 + MOVE_THROTTLE_MS + 500)).toBe(true);
  });

  it("always allows the first emit (lastEmitAt = 0, real Date.now() timestamp)", () => {
    expect(shouldEmitMove(0, Date.now())).toBe(true);
  });
});

describe("classifyDragEnd", () => {
  it("classifies a release near or below the bottom edge as \"end\"", () => {
    expect(classifyDragEnd(750, 800)).toBe("end");
    expect(classifyDragEnd(850, 800)).toBe("end");
  });

  it("classifies a release clearly inside the canvas as \"cancel\"", () => {
    expect(classifyDragEnd(200, 800)).toBe("cancel");
  });

  it("honors a custom threshold", () => {
    expect(classifyDragEnd(790, 800, 20)).toBe("end");
    expect(classifyDragEnd(770, 800, 20)).toBe("cancel");
  });
});
