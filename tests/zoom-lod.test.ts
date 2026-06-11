import { describe, expect, it } from "bun:test";
import { lodForZoom, DB_LOD } from "@/lib/zoom-lod";

describe("lodForZoom", () => {
  it("maps zoom ranges to full / mid / far", () => {
    expect(lodForZoom(1, "full")).toBe("full");
    expect(lodForZoom(0.5, "full")).toBe("mid");
    expect(lodForZoom(0.29, "full")).toBe("far");
    expect(lodForZoom(0.29, "mid")).toBe("far");
  });

  it("hysteresis: stays in the current level inside the dead band", () => {
    // mid→full only above 0.6 — 0.57 keeps mid, but a fresh full at 0.57 stays full.
    expect(lodForZoom(0.57, "mid")).toBe("mid");
    expect(lodForZoom(0.57, "full")).toBe("full");
    expect(lodForZoom(0.62, "mid")).toBe("full");
    // far→mid only above 0.34 — 0.32 keeps far, 0.36 exits to mid.
    expect(lodForZoom(0.32, "far")).toBe("far");
    expect(lodForZoom(0.32, "mid")).toBe("mid");
    expect(lodForZoom(0.36, "far")).toBe("mid");
  });

  it("jumping straight from far to a high zoom lands on full", () => {
    expect(lodForZoom(0.9, "far")).toBe("full");
  });

  it("DB_LOD keeps full table cards at the board's fit zoom (~0.38)", () => {
    // The DB board fits the whole schema at ~0.38 (fitView minZoom). Tables must render full
    // — with columns — at that level so the user sees every table as a whole, not name pills.
    expect(lodForZoom(0.38, "full", DB_LOD)).toBe("full");
    expect(lodForZoom(0.38, "mid", DB_LOD)).toBe("full");
    // Only collapse when the user zooms further out than the fit level.
    expect(lodForZoom(0.3, "full", DB_LOD)).toBe("mid");
    expect(lodForZoom(0.18, "full", DB_LOD)).toBe("far");
  });
});
