import { describe, expect, it } from "bun:test";
import { buildFileIndex, resolveFileToken, resolveMentionedFiles } from "@/lib/file-mention";

// A small repo: several files share the basename `route.ts`, two share a longer suffix
// (`[id]/route.ts`) for the path-qualified-ambiguity (dropdown) case, plus uniquely-named files.
const FILES = [
  "app/api/plan/route.ts",
  "app/api/open/route.ts",
  "app/users/[id]/route.ts",
  "app/orgs/[id]/route.ts",
  "components/plan/markdown-view.tsx",
  "lib/db.ts",
  "lib/editor.ts",
];

const index = buildFileIndex(FILES);

describe("resolveFileToken", () => {
  it("resolves an exact repo-relative path to that single file", () => {
    expect(resolveFileToken(index, "app/api/plan/route.ts")).toEqual(["app/api/plan/route.ts"]);
  });

  it("resolves a unique basename to its single file", () => {
    expect(resolveFileToken(index, "markdown-view.tsx")).toEqual([
      "components/plan/markdown-view.tsx",
    ]);
  });

  it("does NOT linkify a bare filename that matches several files — it is not a deliberate reference", () => {
    // `route.ts` alone matches many files; that is noise, not a same-name disambiguation.
    expect(resolveFileToken(index, "route.ts")).toEqual([]);
  });

  it("offers a dropdown only for a PATH-QUALIFIED token that still matches several same-name files", () => {
    expect(resolveFileToken(index, "[id]/route.ts")).toEqual([
      "app/orgs/[id]/route.ts",
      "app/users/[id]/route.ts",
    ]);
  });

  it("returns no candidates for a token that matches no real file", () => {
    expect(resolveFileToken(index, "does-not-exist.ts")).toEqual([]);
    // A bare code identifier that is not a real file must not linkify.
    expect(resolveFileToken(index, "db")).toEqual([]);
    expect(resolveFileToken(index, "pinned()")).toEqual([]);
  });

  it("ignores multi-word code (commands) that can't be a path", () => {
    expect(resolveFileToken(index, "bun run db:generate")).toEqual([]);
  });

  it("normalizes a leading ./ and leading /", () => {
    expect(resolveFileToken(index, "./lib/db.ts")).toEqual(["lib/db.ts"]);
    expect(resolveFileToken(index, "/lib/db.ts")).toEqual(["lib/db.ts"]);
  });

  it("strips a trailing :line (and :line:col) suffix before matching", () => {
    expect(resolveFileToken(index, "lib/db.ts:42")).toEqual(["lib/db.ts"]);
    expect(resolveFileToken(index, "lib/db.ts:42:7")).toEqual(["lib/db.ts"]);
  });

  it("disambiguates a partial path by suffix instead of returning every same-name file", () => {
    // `plan/route.ts` is a path fragment — it must select only the matching file, not both route.ts.
    expect(resolveFileToken(index, "plan/route.ts")).toEqual(["app/api/plan/route.ts"]);
  });

  it("trims surrounding whitespace", () => {
    expect(resolveFileToken(index, "  lib/editor.ts  ")).toEqual(["lib/editor.ts"]);
  });

  it("returns no candidates against an empty index", () => {
    expect(resolveFileToken(buildFileIndex([]), "lib/db.ts")).toEqual([]);
  });
});

describe("resolveMentionedFiles (scope-contract seed)", () => {
  it("collects backticked tokens that resolve to exactly one real file, sorted + deduped", () => {
    const md = "We edit `lib/db.ts` and `components/plan/markdown-view.tsx`, then `lib/db.ts` again.";
    expect(resolveMentionedFiles(md, FILES)).toEqual([
      "components/plan/markdown-view.tsx",
      "lib/db.ts",
    ]);
  });

  it("ignores ambiguous bare names, prose, and non-existent paths", () => {
    const md = "Touch `route.ts` (ambiguous) and `lib/does-not-exist.ts`; also the `plan` page.";
    expect(resolveMentionedFiles(md, FILES)).toEqual([]);
  });

  it("resolves a path-qualified token and strips a :line suffix", () => {
    const md = "See `app/api/plan/route.ts:42` for the handler.";
    expect(resolveMentionedFiles(md, FILES)).toEqual(["app/api/plan/route.ts"]);
  });

  it("returns nothing for prose with no code spans", () => {
    expect(resolveMentionedFiles("Just a plain sentence.", FILES)).toEqual([]);
  });
});
