import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  buildCodeGraph,
  createIncrementalCodeGraph,
} from "@/intel/extractors/code-graph";

function fixture(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "code-graph-incr-"));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    const dir = full.slice(0, full.lastIndexOf("/"));
    if (dir && dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
const pairs = (s: { edges: { from: string; to: string }[] }) =>
  s.edges.map((e) => `${e.from}→${e.to}`).sort();

describe("createIncrementalCodeGraph", () => {
  it("seed() matches a full buildCodeGraph (files + edges)", async () => {
    const root = fixture({
      "app/page.tsx": `import { db } from "@/lib/db"; import "./local";`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
      "lib/db.ts": ``,
      "app/local.ts": ``,
    });
    const incr = createIncrementalCodeGraph(root);
    const seeded = await incr.seed();
    const full = await buildCodeGraph(root);
    expect(seeded.files.map((f) => f.path).sort()).toEqual(full.files.map((f) => f.path).sort());
    expect(pairs(seeded)).toEqual(pairs(full));
  });

  it("mtime gate: an unchanged file is a no-op", async () => {
    const root = fixture({ "a.ts": `import "./b";`, "b.ts": `` });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    expect(await incr.applyChange(join(root, "a.ts"))).toBe(false); // same mtime/size
  });

  it("content change re-extracts only that file and updates edges", async () => {
    const root = fixture({ "a.ts": `import "./b";`, "b.ts": ``, "c.ts": `` });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    expect(pairs(incr.snapshot())).toEqual(["a.ts→b.ts"]);

    writeFileSync(join(root, "a.ts"), `import "./c"; // now points at c`);
    expect(await incr.applyChange(join(root, "a.ts"))).toBe(true);
    expect(pairs(incr.snapshot())).toEqual(["a.ts→c.ts"]);
  });

  it("adding a file lights up an UNCHANGED importer (re-resolution)", async () => {
    const root = fixture({ "a.ts": `import "./b";` });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    expect(pairs(incr.snapshot())).toEqual([]); // b doesn't exist yet

    writeFileSync(join(root, "b.ts"), ``);
    expect(await incr.applyChange(join(root, "b.ts"))).toBe(true);
    expect(pairs(incr.snapshot())).toEqual(["a.ts→b.ts"]); // a wasn't touched, edge appears
  });

  it("deleting a file drops its node and edges into it", async () => {
    const root = fixture({ "a.ts": `import "./b";`, "b.ts": `` });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    expect(pairs(incr.snapshot())).toEqual(["a.ts→b.ts"]);

    rmSync(join(root, "b.ts"));
    expect(await incr.applyChange(join(root, "b.ts"))).toBe(true);
    expect(incr.snapshot().files.map((f) => f.path)).toEqual(["a.ts"]);
    expect(pairs(incr.snapshot())).toEqual([]);
  });

  it("ignores non-source / ignored paths without reading them", async () => {
    const root = fixture({ "a.ts": `` });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    expect(await incr.applyChange(join(root, "node_modules/x/index.js"))).toBe(false);
    expect(await incr.applyChange(join(root, "README.md"))).toBe(false);
    expect(await incr.applyChange(join(root, ".env.ts"))).toBe(false);
  });

  it("skips minified/overlong-line files (no spin, no edges from them)", async () => {
    const root = fixture({
      "big.ts": `import "./b";\n` + "x".repeat(60_000), // line 2 is >50k chars → minified
      "b.ts": ``,
    });
    const incr = createIncrementalCodeGraph(root);
    await incr.seed();
    // big.ts is tracked as a file but contributes NO edges (extraction skipped).
    expect(incr.snapshot().files.map((f) => f.path).sort()).toEqual(["b.ts", "big.ts"]);
    expect(pairs(incr.snapshot())).toEqual([]);
  });
});
