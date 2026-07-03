import { describe, expect, it } from "bun:test";
import {
  EPISODE_NOW_MS,
  groupEpisodes,
  isNoisePath,
  orderForReview,
  reviewScore,
  testStem,
} from "@/lib/changes-order";
import type { ChangedFile } from "@/lib/changes";
import type { TouchedMap } from "@/lib/touched-files";

const f = (path: string, add = 1, del = 0, inDegree = 0): ChangedFile =>
  ({ path, status: "modified", additions: add, deletions: del, lang: "typescript", symbols: [], inDegree }) as ChangedFile;

describe("isNoisePath", () => {
  it("flags lockfiles, minified, maps, generated dirs", () => {
    for (const p of ["bun.lock", "package-lock.json", "x/y.min.js", "app.js.map", ".next/x.js", "dist/a.js", "node_modules/x.ts"])
      expect(isNoisePath(p)).toBe(true);
    expect(isNoisePath("lib/changes.ts")).toBe(false);
  });
});

describe("testStem", () => {
  it("extracts the subject stem from test paths", () => {
    expect(testStem("tests/changes.test.ts")).toBe("changes");
    expect(testStem("src/foo.spec.tsx")).toBe("foo");
    expect(testStem("lib/changes.ts")).toBeNull();
  });
});

describe("orderForReview", () => {
  it("orders by score desc (size × importer weight), noise last", () => {
    const { main, noise } = orderForReview([
      f("a.ts", 10, 0, 0),
      f("hub.ts", 10, 0, 30), // same size, heavily imported → first
      f("bun.lock", 500, 0, 0), // noise despite size
    ]);
    expect(main.map((x) => x.path)).toEqual(["hub.ts", "a.ts"]);
    expect(noise.map((x) => x.path)).toEqual(["bun.lock"]);
  });

  it("pulls a test file directly after its subject", () => {
    const { main } = orderForReview([
      f("lib/changes.ts", 50, 0, 10),
      f("lib/other.ts", 40, 0, 8),
      f("tests/changes.test.ts", 5, 0, 0),
    ]);
    expect(main.map((x) => x.path)).toEqual(["lib/changes.ts", "tests/changes.test.ts", "lib/other.ts"]);
  });

  it("keeps unmatched tests at the end in score order", () => {
    const { main } = orderForReview([f("lib/a.ts", 10, 0, 0), f("tests/orphan.test.ts", 30, 0, 0)]);
    expect(main.map((x) => x.path)).toEqual(["lib/a.ts", "tests/orphan.test.ts"]);
  });

  it("reviewScore grows with inDegree", () => {
    expect(reviewScore({ additions: 10, deletions: 0, inDegree: 30 })).toBeGreaterThan(
      reviewScore({ additions: 10, deletions: 0, inDegree: 0 }),
    );
  });
});

describe("groupEpisodes", () => {
  const NOW = 1_000_000_000;
  const touched: TouchedMap = {
    "hot.ts": { count: 3, lastAt: NOW - 30_000 }, // within 5 min → "Now"
    "warm.ts": { count: 1, lastAt: NOW - EPISODE_NOW_MS * 3 }, // touched earlier this session
  };

  it("splits into Now / Earlier this session / Before this session", () => {
    const eps = groupEpisodes([f("hot.ts"), f("warm.ts"), f("cold.ts")], touched, NOW);
    expect(eps.map((e) => e.key)).toEqual(["now", "session", "before"]);
    expect(eps[0].files.map((x) => x.path)).toEqual(["hot.ts"]);
    expect(eps[1].files.map((x) => x.path)).toEqual(["warm.ts"]);
    expect(eps[2].files.map((x) => x.path)).toEqual(["cold.ts"]);
  });

  it("orders inside an episode by recency desc and omits empty episodes", () => {
    const t: TouchedMap = {
      "a.ts": { count: 1, lastAt: NOW - 10_000 },
      "b.ts": { count: 1, lastAt: NOW - 5_000 },
    };
    const eps = groupEpisodes([f("a.ts"), f("b.ts")], t, NOW);
    expect(eps).toHaveLength(1);
    expect(eps[0].key).toBe("now");
    expect(eps[0].files.map((x) => x.path)).toEqual(["b.ts", "a.ts"]);
  });
});
