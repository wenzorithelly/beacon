import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { buildCodeGraph, scanCodeFiles } from "@/intel/extractors/code-graph";

function fixture(layout: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "code-graph-"));
  for (const [path, content] of Object.entries(layout)) {
    const full = join(root, path);
    const dir = full.slice(0, full.lastIndexOf("/"));
    if (dir && dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

describe("scanCodeFiles", () => {
  it("walks TS/TSX/JS/JSX and skips junk dirs + .d.ts + dotfiles", async () => {
    const root = fixture({
      "app/page.tsx": "",
      "lib/db.ts": "",
      "lib/types.d.ts": "",
      "node_modules/x/index.js": "",
      ".next/build.js": "",
      "lib/generated/prisma/client.ts": "",
      "scripts/seed.mjs": "",
      "intel/foo.cjs": "",
      "README.md": "",
    });
    const out = await scanCodeFiles(root);
    expect(out).toEqual([
      "app/page.tsx",
      "intel/foo.cjs",
      "lib/db.ts",
      "scripts/seed.mjs",
    ]);
  });

  it("indexes Drizzle schema source under a drizzle/ dir (only the generated SQL output is excluded, by extension)", async () => {
    // Regression: `drizzle` was in SKIP_DIRS to drop the generated migration output
    // dir, but that pruned lib/drizzle/schema.ts — the canonical schema source — so its
    // tables never reached the /db board. The generated output is .sql + meta/*.json,
    // neither an indexed extension, so it stays out of the graph WITHOUT a dir skip.
    const root = fixture({
      "lib/drizzle/schema.ts": `import { sqliteTable } from "drizzle-orm/sqlite-core";`,
      "lib/drizzle/relations.ts": "",
      "drizzle/0000_init.sql": "CREATE TABLE x (id integer);",
      "drizzle/meta/_journal.json": "{}",
      "app/page.tsx": "",
    });
    const out = await scanCodeFiles(root);
    expect(out).toContain("lib/drizzle/schema.ts");
    expect(out).toContain("lib/drizzle/relations.ts");
    expect(out).not.toContain("drizzle/0000_init.sql");
    expect(out).not.toContain("drizzle/meta/_journal.json");
  });

  it("returns POSIX-style relative paths sorted", async () => {
    const root = fixture({
      "z/file.ts": "",
      "a/b/c.ts": "",
      "m.ts": "",
    });
    const out = await scanCodeFiles(root);
    expect(out).toEqual(["a/b/c.ts", "m.ts", "z/file.ts"]);
    for (const p of out) expect(p).not.toContain("\\");
  });
});

describe("buildCodeGraph", () => {
  it("emits one edge per resolved internal import; ignores externals + self-edges", async () => {
    const root = fixture({
      "app/page.tsx": `
        import { db } from "../lib/db";
        import { utils } from "../lib/utils";
        import Foo from "react";
      `,
      "lib/db.ts": `import { z } from "zod";`,
      "lib/utils.ts": ``,
    });
    const g = await buildCodeGraph(root);
    expect(g.files.map((f) => f.path).sort()).toEqual([
      "app/page.tsx",
      "lib/db.ts",
      "lib/utils.ts",
    ]);
    const pairs = g.edges.map((e) => `${e.from}→${e.to}`).sort();
    expect(pairs).toEqual([
      "app/page.tsx→lib/db.ts",
      "app/page.tsx→lib/utils.ts",
    ]);
  });

  it("dedupes multiple imports of the same target into one edge", async () => {
    const root = fixture({
      "a.ts": `
        import { x } from "./b";
        import { y } from "./b";
        import type { Z } from "./b";
      `,
      "b.ts": "",
    });
    const g = await buildCodeGraph(root);
    expect(g.edges).toEqual([{ from: "a.ts", to: "b.ts" }]);
  });

  it("handles index re-exports (foo → foo/index)", async () => {
    const root = fixture({
      "app/page.tsx": `import { x } from "../lib/utils";`,
      "lib/utils/index.ts": ``,
    });
    const g = await buildCodeGraph(root);
    expect(g.edges).toEqual([
      { from: "app/page.tsx", to: "lib/utils/index.ts" },
    ]);
  });

  it("returns empty graph for a repo with no source files", async () => {
    const root = fixture({ "README.md": "" });
    const g = await buildCodeGraph(root);
    expect(g.files).toEqual([]);
    expect(g.edges).toEqual([]);
  });

  it("resolves TS path aliases from tsconfig (@/* → repo-relative)", async () => {
    const root = fixture({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { paths: { "@/*": ["./*"] } },
      }),
      "app/layout.tsx": `
        import { TopNav } from "@/components/top-nav";
        import { db } from "@/lib/db";
      `,
      "components/top-nav.tsx": ``,
      "lib/db.ts": ``,
    });
    const g = await buildCodeGraph(root);
    const pairs = g.edges.map((e) => `${e.from}→${e.to}`).sort();
    expect(pairs).toEqual([
      "app/layout.tsx→components/top-nav.tsx",
      "app/layout.tsx→lib/db.ts",
    ]);
  });

  it("does NOT mis-resolve bare packages onto similarly-named files", async () => {
    // Regression: extractImports' fuzzy fallback resolved `from "next"` to
    // `next.config.ts` via a prefix match. The new resolver must not.
    const root = fixture({
      "app/page.tsx": `
        import Foo from "next";
        import React from "react";
        import { x } from "next/server";
      `,
      "next.config.ts": ``,
      "react.config.ts": ``,
    });
    const g = await buildCodeGraph(root);
    expect(g.edges).toEqual([]);
  });

  it("captures dynamic imports and bare side-effect imports", async () => {
    const root = fixture({
      "a.ts": `
        import "./side-effect";
        const m = await import("./lazy");
        require("./cjs");
      `,
      "side-effect.ts": "",
      "lazy.ts": "",
      "cjs.ts": "",
    });
    const g = await buildCodeGraph(root);
    const targets = g.edges.map((e) => e.to).sort();
    expect(targets).toEqual(["cjs.ts", "lazy.ts", "side-effect.ts"]);
  });

  it("catches imports buried inside function bodies (no head cap)", async () => {
    // Pad with noise large enough that a 16 KB head cap would miss the require.
    const padding = "// noise line\n".repeat(2000); // ~28 KB
    const root = fixture({
      "a.ts": `
        export function lazy() {
          ${padding}
          const x = require("./deep");
          return import("./async");
        }
      `,
      "deep.ts": "",
      "async.ts": "",
    });
    const g = await buildCodeGraph(root);
    const targets = g.edges.map((e) => e.to).sort();
    expect(targets).toEqual(["async.ts", "deep.ts"]);
  });

  it("tags each file with its detected language; single-root files have no root", async () => {
    const root = fixture({ "lib/db.ts": "", "api/main.py": "" });
    const g = await buildCodeGraph(root);
    expect(g.files.find((f) => f.path === "lib/db.ts")).toMatchObject({ lang: "ts", root: null });
    expect(g.files.find((f) => f.path === "api/main.py")).toMatchObject({ lang: "py", root: null });
  });
});

describe("buildCodeGraph — multi-root + polyglot", () => {
  it("merges multiple roots into base-relative paths with root + lang tags", async () => {
    const base = fixture({
      "apps/web/page.tsx": `import { x } from "./util";`,
      "apps/web/util.ts": ``,
      "services/api/main.py": `from .helper import f`,
      "services/api/helper.py": ``,
    });
    const g = await buildCodeGraph([join(base, "apps/web"), join(base, "services/api")], base);

    expect(g.files.map((f) => f.path).sort()).toEqual([
      "apps/web/page.tsx",
      "apps/web/util.ts",
      "services/api/helper.py",
      "services/api/main.py",
    ]);
    const file = (p: string) => g.files.find((f) => f.path === p)!;
    expect(file("apps/web/page.tsx")).toMatchObject({ root: "apps/web", lang: "ts" });
    expect(file("services/api/main.py")).toMatchObject({ root: "services/api", lang: "py" });

    // Edges resolve per-language within each root (TS relative + Python relative).
    expect(g.edges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([
      "apps/web/page.tsx→apps/web/util.ts",
      "services/api/main.py→services/api/helper.py",
    ]);
  });

  it("resolves a cross-root relative import into one merged edge", async () => {
    const base = fixture({
      "pkgA/a.ts": `import { c } from "../pkgB/c";`,
      "pkgB/c.ts": ``,
    });
    const g = await buildCodeGraph([join(base, "pkgA"), join(base, "pkgB")], base);
    expect(g.edges.map((e) => `${e.from}→${e.to}`)).toEqual(["pkgA/a.ts→pkgB/c.ts"]);
  });
});
