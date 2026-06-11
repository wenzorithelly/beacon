import { describe, expect, it } from "bun:test";

import { detectFrontendFromPaths, normalizeLayer } from "@/lib/layer";

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
