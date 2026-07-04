import { describe, expect, it } from "bun:test";
import {
  computeChanges,
  isWhitespaceOnlyHunk,
  langFromPath,
  latestEditedFile,
  MAX_CHANGED_LINES,
  parseFullDiff,
  symbolFromHunkContext,
  untrackedFile,
} from "@/lib/changes";

describe("latestEditedFile", () => {
  const f = (path: string, oldPath?: string) => ({ path, oldPath });
  it("returns the most recently touched file that's still in the change set", () => {
    const files = [f("a.ts"), f("b.ts"), f("c.ts")];
    const touched = { "a.ts": { lastAt: 100 }, "b.ts": { lastAt: 300 }, "c.ts": { lastAt: 200 } };
    expect(latestEditedFile(files, touched)?.path).toBe("b.ts");
  });
  it("ignores touched files no longer in the diff (committed/reverted away)", () => {
    const files = [f("a.ts")];
    const touched = { "gone.ts": { lastAt: 999 }, "a.ts": { lastAt: 10 } };
    expect(latestEditedFile(files, touched)?.path).toBe("a.ts");
  });
  it("resolves a renamed file by its pre-rename path", () => {
    const files = [f("new.ts", "old.ts")];
    const touched = { "old.ts": { lastAt: 42 } };
    expect(latestEditedFile(files, touched)).toEqual({ path: "new.ts", lastAt: 42 });
  });
  it("is null when no file in the diff was touched this session", () => {
    expect(latestEditedFile([f("a.ts")], {})).toBeNull();
  });
});

describe("langFromPath", () => {
  it("maps extensions to highlight.js languages", () => {
    expect(langFromPath("app/x.tsx")).toBe("typescript");
    expect(langFromPath("lib/a.js")).toBe("javascript");
    expect(langFromPath("data.json")).toBe("json");
    expect(langFromPath("README.md")).toBe("markdown");
  });
  it("falls back to plaintext for unknown / extensionless", () => {
    expect(langFromPath("Makefile")).toBe("plaintext");
    expect(langFromPath("weird.xyz")).toBe("plaintext");
  });
});

describe("symbolFromHunkContext", () => {
  it("extracts identifiers from ts/js/py/go-style contexts", () => {
    expect(symbolFromHunkContext("export async function approvePlan(opts?: {")).toBe("approvePlan");
    expect(symbolFromHunkContext("export const GET = pinned(async (req: Request) => {")).toBe("GET");
    expect(symbolFromHunkContext("  def compute_changes(now):")).toBe("compute_changes");
    expect(symbolFromHunkContext("class DraftStore {")).toBe("DraftStore");
    expect(symbolFromHunkContext("")).toBeNull();
  });
});

describe("isWhitespaceOnlyHunk", () => {
  it("true when trimmed non-empty lines match as multisets", () => {
    expect(isWhitespaceOnlyHunk(["  a = 1", "b=2"], ["a = 1", "  b=2", ""])).toBe(true);
  });
  it("false when content actually changed", () => {
    expect(isWhitespaceOnlyHunk(["a = 1"], ["a = 2"])).toBe(false);
  });
  it("false when a line was only removed", () => {
    expect(isWhitespaceOnlyHunk(["a", "b"], ["a"])).toBe(false);
  });
});

describe("parseFullDiff", () => {
  const RAW = [
    "diff --git a/lib/x.ts b/lib/x.ts",
    "index 111..222 100644",
    "--- a/lib/x.ts",
    "+++ b/lib/x.ts",
    "@@ -10,4 +10,5 @@ export function alpha() {",
    " ctx",
    "-old line",
    "+new line",
    "+added line",
    " ctx",
    "@@ -30,3 +31,3 @@ export function beta() {",
    " ctx",
    "-  spaced",
    "+spaced",
    " ctx",
    "diff --git a/old.ts b/renamed.ts",
    "similarity index 90%",
    "rename from old.ts",
    "rename to renamed.ts",
    "--- a/old.ts",
    "+++ b/renamed.ts",
    "@@ -1,2 +1,2 @@",
    "-a",
    "+b",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-x",
    "-y",
    "diff --git a/img.png b/img.png",
    "index 111..222 100644",
    "Binary files a/img.png and b/img.png differ",
    "",
  ].join("\n");

  it("parses status, counts, symbols, hunks per file", () => {
    const m = parseFullDiff(RAW);
    const x = m.get("lib/x.ts")!;
    expect(x.status).toBe("modified");
    expect(x.additions).toBe(3);
    expect(x.deletions).toBe(2);
    expect(x.symbols).toEqual(["alpha", "beta"]);
    expect(x.hunks).toBe(2);
    expect(x.formattingOnly).toBe(false); // hunk 1 is a real change
  });

  it("handles renames, deletions and binary files", () => {
    const m = parseFullDiff(RAW);
    expect(m.get("renamed.ts")).toMatchObject({ status: "renamed", oldPath: "old.ts" });
    expect(m.get("gone.ts")).toMatchObject({ status: "deleted", deletions: 2 });
    expect(m.get("img.png")).toMatchObject({ binary: true });
  });

  it("flags a file whose every hunk is whitespace-only", () => {
    const ws = parseFullDiff(
      ["diff --git a/w.ts b/w.ts", "--- a/w.ts", "+++ b/w.ts", "@@ -1,2 +1,2 @@", "-  a=1", "+a=1", ""].join("\n"),
    );
    expect(ws.get("w.ts")!.formattingOnly).toBe(true);
  });

  it("marks a new file added", () => {
    const m = parseFullDiff(
      ["diff --git a/n.ts b/n.ts", "new file mode 100644", "--- /dev/null", "+++ b/n.ts", "@@ -0,0 +1,1 @@", "+hello", ""].join("\n"),
    );
    expect(m.get("n.ts")).toMatchObject({ status: "added", additions: 1 });
  });

  it("returns an empty map for empty input", () => {
    expect(parseFullDiff("").size).toBe(0);
  });
});

describe("computeChanges shape", () => {
  it("returns the full touched map (not just keys)", () => {
    const r = computeChanges();
    expect(r).toHaveProperty("touched");
    for (const v of Object.values(r.touched)) {
      expect(typeof v.count).toBe("number");
      expect(typeof v.lastAt).toBe("number");
    }
  });
});

describe("untrackedFile", () => {
  it("counts lines as additions, ignoring the trailing newline", () => {
    const f = untrackedFile("new.ts", "one\ntwo\n");
    expect(f.status).toBe("added");
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(0);
    expect(f.lang).toBe("typescript");
    expect(f.symbols).toEqual([]);
  });

  it("counts a file with no trailing newline", () => {
    const f = untrackedFile("a.txt", "only");
    expect(f.additions).toBe(1);
  });

  it("flags a too-large file", () => {
    const big = Array.from({ length: MAX_CHANGED_LINES + 5 }, (_, i) => `l${i}`).join("\n");
    const f = untrackedFile("big.ts", big);
    expect(f.tooLarge).toBe(true);
  });

  it("counts an empty file as zero additions", () => {
    const f = untrackedFile("empty.ts", "");
    expect(f.additions).toBe(0);
  });
});
