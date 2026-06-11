import { describe, expect, it } from "bun:test";

import {
  detectFrontendFromPaths,
  LAYER_COLORS,
  layerStripeCss,
  normalizeLayer,
} from "@/lib/layer";

describe("normalizeLayer", () => {
  it("accepts the three canonical values case-insensitively", () => {
    expect(normalizeLayer("frontend")).toBe("frontend");
    expect(normalizeLayer("Frontend")).toBe("frontend");
    expect(normalizeLayer("BACKEND")).toBe("backend");
    expect(normalizeLayer("FULLSTACK")).toBe("fullstack");
  });

  it("tolerates common spellings of fullstack", () => {
    expect(normalizeLayer("full-stack")).toBe("fullstack");
    expect(normalizeLayer("full stack")).toBe("fullstack");
  });

  it("tolerates FE/BE/FS shorthands", () => {
    expect(normalizeLayer("FE")).toBe("frontend");
    expect(normalizeLayer("be")).toBe("backend");
    expect(normalizeLayer("fs")).toBe("fullstack");
  });

  it("returns null for garbage, empty, and nullish input", () => {
    expect(normalizeLayer("middleware")).toBeNull();
    expect(normalizeLayer("")).toBeNull();
    expect(normalizeLayer("   ")).toBeNull();
    expect(normalizeLayer(null)).toBeNull();
    expect(normalizeLayer(undefined)).toBeNull();
  });
});

describe("detectFrontendFromPaths", () => {
  it("detects frontend component files", () => {
    expect(detectFrontendFromPaths(["app/page.tsx", "lib/db.ts"])).toBe(true);
    expect(detectFrontendFromPaths(["src/App.jsx"])).toBe(true);
    expect(detectFrontendFromPaths(["src/Button.vue"])).toBe(true);
    expect(detectFrontendFromPaths(["src/Card.svelte"])).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(detectFrontendFromPaths(["weird/Path.TSX"])).toBe(true);
  });

  it("returns false for backend-only file sets", () => {
    expect(detectFrontendFromPaths(["main.py", "lib/api.ts", "cmd/server.go"])).toBe(false);
    expect(detectFrontendFromPaths([])).toBe(false);
  });

  it("does not match the extension mid-path", () => {
    expect(detectFrontendFromPaths(["docs/tsx-notes/readme.md"])).toBe(false);
  });
});

describe("layerStripeCss", () => {
  it("returns the solid layer color for frontend and backend", () => {
    expect(layerStripeCss("frontend")).toBe(LAYER_COLORS.frontend);
    expect(layerStripeCss("backend")).toBe(LAYER_COLORS.backend);
  });

  it("returns a hard-stop split of both colors for fullstack", () => {
    const css = layerStripeCss("fullstack");
    expect(css).toContain("linear-gradient");
    expect(css).toContain(LAYER_COLORS.frontend);
    expect(css).toContain(LAYER_COLORS.backend);
    expect(css).toContain("50%"); // hard stop, not a blend
  });

  it("keeps the two layer hues distinct from each other and the brand accent", () => {
    expect(LAYER_COLORS.frontend).not.toBe(LAYER_COLORS.backend);
    expect(Object.values(LAYER_COLORS)).not.toContain("#ff7a45");
  });
});
