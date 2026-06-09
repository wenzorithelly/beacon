import { describe, expect, it } from "bun:test";
import { mergeTouched, toRepoRelative } from "@/lib/touched-files";

describe("toRepoRelative", () => {
  const root = "/Users/me/repo";
  it("strips the repo root from an absolute in-repo path (matching canvas node ids)", () => {
    expect(toRepoRelative("/Users/me/repo/lib/a.ts", root)).toBe("lib/a.ts");
    expect(toRepoRelative("/Users/me/repo/components/graph/x.tsx", root)).toBe("components/graph/x.tsx");
  });
  it("keeps an already repo-relative path", () => {
    expect(toRepoRelative("lib/a.ts", root)).toBe("lib/a.ts");
  });
  it("drops an absolute path OUTSIDE the repo (e.g. ~/.claude memos)", () => {
    expect(toRepoRelative("/Users/me/.claude/notes.md", root)).toBeNull();
    expect(toRepoRelative("/Users/me/other-repo/x.ts", root)).toBeNull();
  });
});

describe("mergeTouched", () => {
  it("adds new paths with count 1 and the given timestamp", () => {
    const out = mergeTouched({}, ["lib/a.ts", "lib/b.ts"], 1000);
    expect(out).toEqual({
      "lib/a.ts": { count: 1, lastAt: 1000 },
      "lib/b.ts": { count: 1, lastAt: 1000 },
    });
  });

  it("bumps the count and advances lastAt on a repeat edit", () => {
    const first = mergeTouched({}, ["lib/a.ts"], 1000);
    const second = mergeTouched(first, ["lib/a.ts"], 2000);
    expect(second["lib/a.ts"]).toEqual({ count: 2, lastAt: 2000 });
  });

  it("leaves untouched paths intact", () => {
    const prev = { "lib/a.ts": { count: 3, lastAt: 500 } };
    const out = mergeTouched(prev, ["lib/b.ts"], 1000);
    expect(out["lib/a.ts"]).toEqual({ count: 3, lastAt: 500 });
    expect(out["lib/b.ts"]).toEqual({ count: 1, lastAt: 1000 });
  });

  it("ignores blank paths", () => {
    expect(mergeTouched({}, ["", "  "], 1000)).toEqual({});
  });
});
