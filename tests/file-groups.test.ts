import { describe, expect, it } from "bun:test";

import { buildGroupKeys, topDir } from "@/lib/file-groups";

const expand = (prefix: string, names: string[]) => names.map((n) => `${prefix}/${n}`);

describe("topDir", () => {
  it("returns the first path segment, or (root) for root files", () => {
    expect(topDir("lib/db.ts")).toBe("lib");
    expect(topDir("a/b/c.ts")).toBe("a");
    expect(topDir("README.md")).toBe("(root)");
  });
});

describe("buildGroupKeys", () => {
  it("keeps top-level directories when nothing dominates", () => {
    const paths = [
      ...expand("lib", ["a.ts", "b.ts"]),
      ...expand("components", ["c.tsx", "d.tsx"]),
      "main.ts",
    ];
    const g = buildGroupKeys(paths);
    expect(g.get("lib/a.ts")).toBe("lib");
    expect(g.get("components/c.tsx")).toBe("components");
    expect(g.get("main.ts")).toBe("(root)");
  });

  it("splits a dominant single-package dir one level deeper", () => {
    // 16 files under app/ (dominant), 2 in tests → app splits into app/services, app/routers.
    const paths = [
      ...expand("app/services", Array.from({ length: 8 }, (_, i) => `s${i}.py`)),
      ...expand("app/routers", Array.from({ length: 8 }, (_, i) => `r${i}.py`)),
      ...expand("tests", ["t1.py", "t2.py"]),
    ];
    const g = buildGroupKeys(paths);
    expect(g.get("app/services/s0.py")).toBe("app/services");
    expect(g.get("app/routers/r0.py")).toBe("app/routers");
    expect(g.get("tests/t1.py")).toBe("tests");
  });

  it("recursively splits a dominant nested package (monolith backend/app/…)", () => {
    // The juriscan shape: backend/ dominates, and inside it backend/app dominates again.
    // One-level splitting left backend/app as a giant blob; recursion reaches the real
    // structure: backend/app/services, backend/app/api, …
    const paths = [
      ...expand("backend/app/services", Array.from({ length: 12 }, (_, i) => `s${i}.py`)),
      ...expand("backend/app/api", Array.from({ length: 12 }, (_, i) => `a${i}.py`)),
      ...expand("backend/app/models", Array.from({ length: 12 }, (_, i) => `m${i}.py`)),
      ...expand("backend/tests", Array.from({ length: 4 }, (_, i) => `t${i}.py`)),
      ...expand("frontend/src/app", ["page.tsx", "layout.tsx"]),
    ];
    const g = buildGroupKeys(paths);
    expect(g.get("backend/app/services/s0.py")).toBe("backend/app/services");
    expect(g.get("backend/app/api/a0.py")).toBe("backend/app/api");
    expect(g.get("backend/app/models/m0.py")).toBe("backend/app/models");
    expect(g.get("backend/tests/t0.py")).toBe("backend/tests");
    // Non-dominant side stays a single coherent group.
    expect(g.get("frontend/src/app/page.tsx")).toBe("frontend");
  });

  it("descends through a wrapper dir (src/) instead of stopping on it", () => {
    // Everything under web/src → splitting web yields the wrapper web/src, which still
    // dominates and splits again into the real packages.
    const paths = [
      ...expand("web/src/app", Array.from({ length: 8 }, (_, i) => `p${i}.tsx`)),
      ...expand("web/src/components", Array.from({ length: 8 }, (_, i) => `c${i}.tsx`)),
      ...expand("scripts", ["x.ts", "y.ts"]),
    ];
    const g = buildGroupKeys(paths);
    expect(g.get("web/src/app/p0.tsx")).toBe("web/src/app");
    expect(g.get("web/src/components/c0.tsx")).toBe("web/src/components");
  });

  it("keeps loose files of a split dir grouped at the dir itself", () => {
    const paths = [
      "app/main.py",
      ...expand("app/services", Array.from({ length: 8 }, (_, i) => `s${i}.py`)),
      ...expand("app/routers", Array.from({ length: 8 }, (_, i) => `r${i}.py`)),
      ...expand("tests", ["t1.py", "t2.py"]),
    ];
    const g = buildGroupKeys(paths);
    expect(g.get("app/main.py")).toBe("app");
  });
});

describe("buildGroupKeys with classification roots", () => {
  it("groups one level below a declared root even when that side is the minority", () => {
    // The screenshot bug: a small frontend collapses to one flat 'frontend' group because the
    // dominant backend owns the global threshold. Declaring 'frontend' as a root splits it.
    const paths = [
      ...expand("backend/app/services", Array.from({ length: 12 }, (_, i) => `s${i}.py`)),
      ...expand("backend/app/api", Array.from({ length: 12 }, (_, i) => `a${i}.py`)),
      ...expand("frontend/components", ["a.tsx", "b.tsx"]),
      ...expand("frontend/app", ["page.tsx"]),
    ];
    const g = buildGroupKeys(paths, ["frontend"]);
    expect(g.get("frontend/components/a.tsx")).toBe("frontend/components");
    expect(g.get("frontend/app/page.tsx")).toBe("frontend/app");
    // Backend is unrooted here, so it keeps the adaptive deep grouping.
    expect(g.get("backend/app/services/s0.py")).toBe("backend/app/services");
  });

  it("uses the longest matching root (a deeper root wins)", () => {
    const paths = [
      ...expand("frontend/components/ui", ["card.tsx", "button.tsx"]),
      ...expand("frontend/app", ["page.tsx"]),
    ];
    const g = buildGroupKeys(paths, ["frontend", "frontend/components"]);
    expect(g.get("frontend/components/ui/card.tsx")).toBe("frontend/components/ui");
    expect(g.get("frontend/app/page.tsx")).toBe("frontend/app");
  });

  it("keeps a file directly under a root grouped at the root", () => {
    const g = buildGroupKeys(
      ["frontend/index.ts", ...expand("frontend/components", ["a.tsx"])],
      ["frontend"],
    );
    expect(g.get("frontend/index.ts")).toBe("frontend");
    expect(g.get("frontend/components/a.tsx")).toBe("frontend/components");
  });

  it("normalizes leading/trailing slashes in roots", () => {
    const g = buildGroupKeys(expand("frontend/app", ["page.tsx"]), ["/frontend/"]);
    expect(g.get("frontend/app/page.tsx")).toBe("frontend/app");
  });

  it("classifies files outside every declared root with the adaptive fallback", () => {
    const paths = [
      ...expand("frontend/app", ["page.tsx"]),
      ...expand("scripts", ["x.ts", "y.ts"]),
      "README.md",
    ];
    const g = buildGroupKeys(paths, ["frontend"]);
    expect(g.get("frontend/app/page.tsx")).toBe("frontend/app");
    expect(g.get("scripts/x.ts")).toBe("scripts");
    expect(g.get("README.md")).toBe("(root)");
  });

  it("is unchanged from the adaptive behavior when roots are empty/undefined", () => {
    const paths = [
      ...expand("backend/app/services", Array.from({ length: 12 }, (_, i) => `s${i}.py`)),
      ...expand("frontend/src/app", ["page.tsx", "layout.tsx"]),
    ];
    const adaptive = buildGroupKeys(paths);
    const empty = buildGroupKeys(paths, []);
    for (const p of paths) expect(empty.get(p)).toBe(adaptive.get(p));
    // Without a declared root the minority frontend still collapses (the original behavior).
    expect(adaptive.get("frontend/src/app/page.tsx")).toBe("frontend");
  });
});
