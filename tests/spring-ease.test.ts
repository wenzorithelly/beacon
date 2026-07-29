import { describe, expect, it } from "bun:test";
import { easeSpringGlide, easeSpringSnap } from "@/lib/spring-ease";

// The JS mirror of motion.css's --spring-glide / --spring-snap linear() curves, used as the
// `ease` function for React Flow's fitView/setCenter. Only property that matters: it behaves
// like a real easing function over the sampled domain (endpoints pinned, values in range).

describe("spring ease samples", () => {
  it("glide starts at 0 and settles near 1 with no overshoot", () => {
    expect(easeSpringGlide(0)).toBe(0);
    expect(easeSpringGlide(1)).toBeCloseTo(0.9962, 4);
    expect(easeSpringGlide(0.5)).toBeGreaterThan(0);
    expect(easeSpringGlide(0.5)).toBeLessThan(1);
  });

  it("snap starts at 0 and overshoots slightly before settling", () => {
    expect(easeSpringSnap(0)).toBe(0);
    expect(easeSpringSnap(1)).toBeCloseTo(1.004, 4);
    expect(Math.max(easeSpringSnap(0.6), easeSpringSnap(0.7))).toBeGreaterThan(1);
  });

  it("clamps out-of-range progress to the first/last sample", () => {
    expect(easeSpringGlide(-1)).toBe(easeSpringGlide(0));
    expect(easeSpringGlide(2)).toBe(easeSpringGlide(1));
  });

  it("interpolates monotonically between two known sample points", () => {
    // Sample 1 of --spring-glide is 0.0202 at t = 1/28; halfway to it should sit between 0 and it.
    const half = easeSpringGlide(0.5 / 28);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(0.0202);
  });
});
