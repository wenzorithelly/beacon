import { describe, expect, it } from "bun:test";
import { buildFileTree, type TreeFile, type TreeFolder, type TreeNode } from "@/lib/file-tree";

// Narrow helpers so the assertions read cleanly.
function asFolder(n: TreeNode): TreeFolder {
  if (n.kind !== "folder") throw new Error(`expected folder, got file ${n.path}`);
  return n;
}
function asFile(n: TreeNode): TreeFile {
  if (n.kind !== "file") throw new Error(`expected file, got folder ${n.path}`);
  return n;
}
const names = (nodes: TreeNode[]) => nodes.map((n) => n.name);

describe("buildFileTree", () => {
  it("nests files under their directories", () => {
    const tree = buildFileTree([{ path: "a/b/c.ts" }, { path: "a/b/d.ts" }], {
      collapseSingleChildFolders: false,
    });
    expect(names(tree)).toEqual(["a"]);
    const a = asFolder(tree[0]);
    expect(a.path).toBe("a");
    expect(names(a.children)).toEqual(["b"]);
    const b = asFolder(a.children[0]);
    expect(b.path).toBe("a/b");
    expect(names(b.children)).toEqual(["c.ts", "d.ts"]);
    expect(asFile(b.children[0]).path).toBe("a/b/c.ts");
  });

  it("keeps a root-level file as a top-level file node", () => {
    const tree = buildFileTree([{ path: "index.ts" }]);
    expect(tree).toHaveLength(1);
    const f = asFile(tree[0]);
    expect(f.name).toBe("index.ts");
    expect(f.path).toBe("index.ts");
  });

  it("sorts folders before files, then alphabetically (case-insensitive)", () => {
    const tree = buildFileTree(
      [{ path: "Zebra.ts" }, { path: "apple.ts" }, { path: "src/x.ts" }, { path: "Lib/y.ts" }],
      { collapseSingleChildFolders: false },
    );
    // folders (Lib, src) before files (apple.ts, Zebra.ts); each group case-insensitive alpha
    expect(names(tree)).toEqual(["Lib", "src", "apple.ts", "Zebra.ts"]);
  });

  it("carries status and meta onto the leaf", () => {
    const tree = buildFileTree([{ path: "a/x.ts", status: "modified", meta: "5×" }]);
    const a = asFolder(tree[0]);
    const x = asFile(a.children[0]);
    expect(x.status).toBe("modified");
    expect(x.meta).toBe("5×");
  });

  it("normalizes Windows backslashes to POSIX separators", () => {
    const tree = buildFileTree([{ path: "a\\b\\c.ts" }], { collapseSingleChildFolders: false });
    const a = asFolder(tree[0]);
    expect(a.name).toBe("a");
    const b = asFolder(a.children[0]);
    expect(b.path).toBe("a/b");
    expect(asFile(b.children[0]).path).toBe("a/b/c.ts");
  });

  it("trims whitespace and skips empty / blank paths", () => {
    const tree = buildFileTree([{ path: "  a/x.ts  " }, { path: "" }, { path: "   " }]);
    const a = asFolder(tree[0]);
    expect(a.path).toBe("a");
    expect(asFile(a.children[0]).path).toBe("a/x.ts");
    expect(tree).toHaveLength(1);
  });

  it("dedupes an identical path (last entry wins)", () => {
    const tree = buildFileTree([
      { path: "a/x.ts", meta: "first" },
      { path: "a/x.ts", meta: "last" },
    ]);
    const a = asFolder(tree[0]);
    expect(a.children).toHaveLength(1);
    expect(asFile(a.children[0]).meta).toBe("last");
  });

  describe("collapseSingleChildFolders", () => {
    it("joins a single-child folder chain into one node (default on)", () => {
      const tree = buildFileTree([{ path: "src/lib/x.ts" }]);
      expect(names(tree)).toEqual(["src/lib"]);
      const folder = asFolder(tree[0]);
      expect(folder.path).toBe("src/lib");
      expect(names(folder.children)).toEqual(["x.ts"]);
    });

    it("does NOT collapse a folder that has a file sibling", () => {
      // a has two children (folder b + file e.ts) → a is not collapsed.
      const tree = buildFileTree([{ path: "a/b/c.ts" }, { path: "a/e.ts" }]);
      expect(names(tree)).toEqual(["a"]);
      const a = asFolder(tree[0]);
      // folders before files: b, then e.ts
      expect(names(a.children)).toEqual(["b", "e.ts"]);
      const b = asFolder(a.children[0]);
      // b's single child is a FILE, so b is not collapsed away either
      expect(names(b.children)).toEqual(["c.ts"]);
    });

    it("does NOT collapse when a folder has two folder children", () => {
      const tree = buildFileTree([{ path: "a/b/x.ts" }, { path: "a/c/y.ts" }]);
      const a = asFolder(tree[0]);
      expect(a.name).toBe("a");
      expect(names(a.children)).toEqual(["b", "c"]);
    });
  });
});
