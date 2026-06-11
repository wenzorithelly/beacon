import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  allExtensions,
  detectLang,
  resolverForPath,
  type ResolveCtx,
} from "@/intel/extractors/languages";

describe("resolver sources: no stateful regex exec loops", () => {
  // The prod bundler (Turbopack/SWC) may inline a module-level regex referenced via
  // array indexing into each use site. A `while ((m = RE.exec(s)))` loop then evaluates
  // a FRESH regex literal per iteration — lastIndex never advances and the loop spins
  // forever, freezing the daemon's event loop at 100% CPU (this wedged prod on the
  // first .py file containing `from … import`). `matchAll` is immune: it is called
  // once and clones the regex internally, so object identity stops mattering.
  it("language resolvers iterate matches with matchAll, never exec", () => {
    const dir = join(import.meta.dir, "../intel/extractors/languages");
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const src = readFileSync(join(dir, f), "utf8");
      expect(src.includes(".exec("), `${f} uses .exec( — use matchAll (see comment above)`).toBe(false);
    }
  });
});

// Minimal ctx builder for resolver unit tests.
function ctx(files: string[], extra: Partial<ResolveCtx> = {}): ResolveCtx {
  return { fileSet: new Set(files), ...extra };
}

describe("registry: detectLang", () => {
  it("maps extensions to clean language ids", () => {
    expect(detectLang("app/page.tsx")).toBe("ts");
    expect(detectLang("lib/db.ts")).toBe("ts");
    expect(detectLang("scripts/x.mjs")).toBe("js");
    expect(detectLang("api/main.py")).toBe("py");
    expect(detectLang("cmd/main.go")).toBe("go");
    expect(detectLang("src/lib.rs")).toBe("rs");
    expect(detectLang("App/View.swift")).toBe("swift");
    expect(detectLang("README.md")).toBeNull();
  });
});

describe("registry: resolverForPath", () => {
  it("dispatches by extension; precise langs get their own resolver, others fall back", () => {
    expect(resolverForPath("a.ts")?.id).toBe("ts");
    expect(resolverForPath("a.py")?.id).toBe("python");
    expect(resolverForPath("a.go")?.id).toBe("go");
    expect(resolverForPath("a.rs")?.id).toBe("rust");
    expect(resolverForPath("a.swift")?.id).toBe("fallback");
    expect(resolverForPath("a.rb")?.id).toBe("fallback");
    expect(resolverForPath("a.md")).toBeNull();
  });

  it("allExtensions covers the precise + fallback set", () => {
    const exts = allExtensions();
    for (const e of [".ts", ".tsx", ".js", ".py", ".go", ".rs", ".swift", ".rb", ".java"]) {
      expect(exts.has(e)).toBe(true);
    }
    expect(exts.has(".md")).toBe(false);
  });
});

describe("python resolver", () => {
  const py = () => resolverForPath("x.py")!;

  it("extracts dotted + relative module specifiers", () => {
    const specs = py().specifiers(`
      import os
      import pkg.helper
      from .sibling import thing
      from ..shared.util import f
    `);
    expect(specs.has("os")).toBe(true);
    expect(specs.has("pkg.helper")).toBe(true);
    expect(specs.has(".sibling")).toBe(true);
    expect(specs.has("..shared.util")).toBe(true);
  });

  it("resolves a relative import to a sibling module", () => {
    const c = ctx(["pkg/a.py", "pkg/b.py"]);
    expect(py().resolve(".b", "pkg/a.py", c)).toEqual(["pkg/b.py"]);
  });

  it("resolves a dotted absolute import to a file or package __init__", () => {
    const c = ctx(["app/main.py", "pkg/helper.py", "pkg/sub/__init__.py"]);
    expect(py().resolve("pkg.helper", "app/main.py", c)).toEqual(["pkg/helper.py"]);
    expect(py().resolve("pkg.sub", "app/main.py", c)).toEqual(["pkg/sub/__init__.py"]);
  });

  it("returns [] for a stdlib/third-party module not in the repo", () => {
    const c = ctx(["app/main.py"]);
    expect(py().resolve("os", "app/main.py", c)).toEqual([]);
  });

  // The monolith layout: the Python package lives BELOW a subdirectory of the scanned
  // root (repo/backend/app/…), so `from app.x import y` can't resolve repo-relative.
  // The resolver walks the importing file's ancestor dirs (deepest first — the closest
  // enclosing package root wins) probing the dotted path under each.
  it("resolves an absolute import whose package root is a subdirectory (monolith backend/)", () => {
    const c = ctx([
      "backend/app/main.py",
      "backend/app/services/match.py",
      "backend/app/api/__init__.py",
    ]);
    expect(py().resolve("app.services.match", "backend/app/main.py", c)).toEqual([
      "backend/app/services/match.py",
    ]);
    expect(py().resolve("app.api", "backend/app/main.py", c)).toEqual([
      "backend/app/api/__init__.py",
    ]);
  });

  it("prefers the closest enclosing root when the dotted path exists at several depths", () => {
    const c = ctx(["backend/app/util.py", "app/util.py", "backend/services/x.py"]);
    // From inside backend/, `app.util` is backend/app/util.py — not the repo-root app/.
    expect(py().resolve("app.util", "backend/services/x.py", c)).toEqual(["backend/app/util.py"]);
  });

  it("still resolves repo-relative absolute imports (flat layout)", () => {
    const c = ctx(["app/main.py", "app/helper.py"]);
    expect(py().resolve("app.helper", "app/main.py", c)).toEqual(["app/helper.py"]);
  });
});

describe("go resolver", () => {
  const go = () => resolverForPath("x.go")!;

  it("extracts single + grouped import specifiers", () => {
    const specs = go().specifiers(`
      package main
      import "fmt"
      import (
        "strings"
        "example.com/app/util"
      )
    `);
    expect(specs.has("fmt")).toBe(true);
    expect(specs.has("strings")).toBe(true);
    expect(specs.has("example.com/app/util")).toBe(true);
  });

  it("resolves a module-prefixed package import to all .go files in that package dir", () => {
    const c = ctx(["cmd/main.go", "util/a.go", "util/b.go", "util/nested/c.go"], {
      goModulePath: "example.com/app",
    });
    expect(go().resolve("example.com/app/util", "cmd/main.go", c).sort()).toEqual([
      "util/a.go",
      "util/b.go",
    ]);
  });

  it("returns [] for stdlib / non-module imports", () => {
    const c = ctx(["cmd/main.go"], { goModulePath: "example.com/app" });
    expect(go().resolve("fmt", "cmd/main.go", c)).toEqual([]);
  });
});

describe("rust resolver", () => {
  const rs = () => resolverForPath("x.rs")!;

  it("normalizes mod declarations and crate/self/super uses into path-like specifiers", () => {
    const specs = rs().specifiers(`
      mod parser;
      use crate::engine::run;
      use super::shared;
      use self::local;
    `);
    expect(specs.has("./parser")).toBe(true);
    expect(specs.has("crate/engine/run")).toBe(true);
    expect(specs.has("../shared")).toBe(true);
    expect(specs.has("./local")).toBe(true);
  });

  it("resolves a mod declaration to a sibling .rs file", () => {
    const c = ctx(["src/lib.rs", "src/parser.rs"]);
    expect(rs().resolve("./parser", "src/lib.rs", c)).toEqual(["src/parser.rs"]);
  });

  it("resolves a mod declaration to a foo/mod.rs file", () => {
    const c = ctx(["src/lib.rs", "src/parser/mod.rs"]);
    expect(rs().resolve("./parser", "src/lib.rs", c)).toEqual(["src/parser/mod.rs"]);
  });
});

describe("fallback resolver (other languages, best-effort)", () => {
  const rb = () => resolverForPath("x.rb")!;

  it("resolves a relative require to a sibling file with the same extension", () => {
    const c = ctx(["app/main.rb", "app/lib/foo.rb"]);
    // require_relative "lib/foo" from app/main.rb
    const out = rb().resolve("lib/foo", "app/main.rb", c);
    expect(out).toEqual(["app/lib/foo.rb"]);
  });

  it("returns [] for a module-style import that maps to no file (e.g. Swift `import Foo`)", () => {
    const sw = resolverForPath("App.swift")!;
    const c = ctx(["App.swift", "Other.swift"]);
    expect(sw.resolve("Foo", "App.swift", c)).toEqual([]);
  });
});
