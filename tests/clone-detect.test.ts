import { describe, expect, it } from "bun:test";
import {
  fingerprints,
  indexFile,
  matchClones,
  tokenizeCode,
  type CloneIndex,
} from "@/lib/clone-detect";

const BLOCK = `
export function resolveWorkspace(req: Request): string | null {
  const header = req.headers.get("x-beacon-workspace");
  if (header && getWorkspace(header)) return header;
  const cookie = cookieValue(req, BEACON_WS_COOKIE);
  if (cookie && getWorkspace(cookie)) return cookie;
  return loneWorkspaceId();
}
`.repeat(3); // enough tokens to clear MIN_ADDED_TOKENS

describe("tokenizeCode", () => {
  it("strips comments and string bodies, keeps identifiers", () => {
    const t = tokenizeCode('const x = "secret value"; // TODO drop\n/* block */ callFn(y)');
    expect(t).toContain("const");
    expect(t).toContain("callfn");
    expect(t).not.toContain("secret");
    expect(t).not.toContain("todo");
  });
});

describe("fingerprints", () => {
  it("identical token streams share fingerprints; different ones don't", () => {
    const a = fingerprints(tokenizeCode(BLOCK));
    const b = fingerprints(tokenizeCode(BLOCK));
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((f) => f.hash)).toEqual(b.map((f) => f.hash));
    const other = fingerprints(tokenizeCode("completely unrelated words ".repeat(30)));
    const set = new Set(a.map((f) => f.hash));
    expect(other.every((f) => !set.has(f.hash))).toBe(true);
  });

  it("returns empty under k tokens", () => {
    expect(fingerprints(["a", "b", "c"])).toEqual([]);
  });
});

describe("matchClones", () => {
  it("detects an added block copied from another repo file", () => {
    const index: CloneIndex = new Map();
    indexFile(index, "lib/original.ts", BLOCK);
    indexFile(index, "lib/unrelated.ts", "const tiny = 1;\n");
    const matches = matchClones(BLOCK.split("\n"), "lib/new-copy.ts", index);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].path).toBe("lib/original.ts");
    expect(matches[0].hits).toBeGreaterThanOrEqual(2);
  });

  it("skips same-file matches and small additions", () => {
    const index: CloneIndex = new Map();
    indexFile(index, "lib/original.ts", BLOCK);
    // Same file → no self-match.
    expect(matchClones(BLOCK.split("\n"), "lib/original.ts", index)).toEqual([]);
    // Too few tokens → no scan.
    expect(matchClones(["const a = 1;"], "lib/x.ts", index)).toEqual([]);
  });

  it("does not flag unrelated additions", () => {
    const index: CloneIndex = new Map();
    indexFile(index, "lib/original.ts", BLOCK);
    const unrelated = Array.from({ length: 30 }, (_, i) => `const unique_${i} = compute_${i}(param_${i}, other_${i});`);
    expect(matchClones(unrelated, "lib/x.ts", index)).toEqual([]);
  });
});
