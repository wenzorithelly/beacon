import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildCodeGraph, createCodeGraphBuilder } from "@/intel/extractors/code-graph";

function fixture(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "code-graph-inc-"));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    const dir = full.slice(0, full.lastIndexOf("/"));
    if (dir && dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("buildCodeGraph — file metadata", () => {
  it("includes mtimeMs + size per file (for incremental + staleness)", () => {
    const root = fixture({ "a.ts": "xx" });
    const f = buildCodeGraph(root).files[0];
    expect(typeof f.mtimeMs).toBe("number");
    expect(f.size).toBe(2); // "xx" is 2 bytes
  });
});

describe("createCodeGraphBuilder — incremental", () => {
  it("re-reads only changed files across rebuilds", () => {
    const root = fixture({
      "a.ts": `import "./b";`,
      "b.ts": ``,
      "c.ts": `import "./b";`,
    });
    const builder = createCodeGraphBuilder(root);

    const first = builder.build();
    expect(first.stats).toMatchObject({ read: 3, reused: 0 });

    // Touch only a.ts (change its size so the stat-only cache misses).
    writeFileSync(join(root, "a.ts"), `import "./b"; // changed`);
    const second = builder.build();
    expect(second.stats).toMatchObject({ read: 1, reused: 2 });

    // Graph itself is unchanged (both a and c still import b).
    expect(second.edges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([
      "a.ts→b.ts",
      "c.ts→b.ts",
    ]);
  });

  it("re-resolves UNCHANGED importers against newly added files", () => {
    // The correctness guarantee: caching extraction (not resolution). Adding b.ts must
    // make a.ts's pre-existing `import "./b"` resolve, even though a.ts wasn't touched.
    const root = fixture({ "a.ts": `import "./b";` });
    const builder = createCodeGraphBuilder(root);

    expect(builder.build().edges).toEqual([]); // b doesn't exist yet

    writeFileSync(join(root, "b.ts"), ``);
    const second = builder.build();
    expect(second.edges).toEqual([{ from: "a.ts", to: "b.ts" }]);
    expect(second.stats).toMatchObject({ read: 1, reused: 1 }); // only b read; a reused
  });

  it("drops vanished files from the graph + cache on rebuild", () => {
    const root = fixture({ "a.ts": ``, "b.ts": `` });
    const builder = createCodeGraphBuilder(root);
    builder.build();

    rmSync(join(root, "b.ts"));
    const g = builder.build();
    expect(g.files.map((f) => f.path)).toEqual(["a.ts"]);
  });
});
