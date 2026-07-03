import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts from an empty store.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-viewed-"));

import { fileSig, readViewedMap, setViewed, viewedStates } from "@/lib/viewed-files";
import type { ChangedFile } from "@/lib/changes";

const f = (path: string, add = 1, del = 0): ChangedFile =>
  ({ path, status: "modified", additions: add, deletions: del, lang: "typescript", symbols: [] }) as ChangedFile;

beforeEach(() => {
  for (const p of Object.keys(readViewedMap())) setViewed(p, null);
});

describe("viewed store", () => {
  it("marks viewed and reads back", () => {
    setViewed("a.ts", fileSig(f("a.ts", 3, 1)));
    expect(readViewedMap()["a.ts"].sig).toBe("modified:3:1");
  });

  it("viewedStates: valid → viewed; sig drift → invalidated; absent → unviewed", () => {
    setViewed("a.ts", fileSig(f("a.ts", 3, 1)));
    setViewed("b.ts", fileSig(f("b.ts", 1, 0)));
    const states = viewedStates([f("a.ts", 3, 1), f("b.ts", 9, 9), f("c.ts")], readViewedMap());
    expect(states["a.ts"]).toBe("viewed");
    expect(states["b.ts"]).toBe("invalidated"); // agent re-edited after viewing
    expect(states["c.ts"]).toBe("unviewed");
  });

  it("unmarks with null", () => {
    setViewed("a.ts", "modified:1:0");
    setViewed("a.ts", null);
    expect(readViewedMap()["a.ts"]).toBeUndefined();
  });
});
