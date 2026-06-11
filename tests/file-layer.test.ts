import { describe, expect, it } from "bun:test";

import { classifyFileLayers } from "@/lib/file-layer";

const e = (from: string, to: string) => ({ from, to });

describe("classifyFileLayers — seeds", () => {
  it("seeds UI-component extensions as frontend", () => {
    const m = classifyFileLayers(
      ["components/button.tsx", "src/App.jsx", "src/Card.vue", "src/Hero.svelte"],
      [],
    );
    expect(m.get("components/button.tsx")).toBe("frontend");
    expect(m.get("src/App.jsx")).toBe("frontend");
    expect(m.get("src/Card.vue")).toBe("frontend");
    expect(m.get("src/Hero.svelte")).toBe("frontend");
  });

  it("seeds API route handlers as backend (app/api + pages/api, also under src/)", () => {
    const m = classifyFileLayers(
      ["app/api/users/route.ts", "src/app/api/x/route.ts", "pages/api/hello.ts"],
      [],
    );
    expect(m.get("app/api/users/route.ts")).toBe("backend");
    expect(m.get("src/app/api/x/route.ts")).toBe("backend");
    expect(m.get("pages/api/hello.ts")).toBe("backend");
  });

  it("seeds server-side language files as backend", () => {
    const m = classifyFileLayers(
      ["services/match.py", "cmd/server.go", "app/models/user.rb", "core/lib.rs"],
      [],
    );
    expect(m.get("services/match.py")).toBe("backend");
    expect(m.get("cmd/server.go")).toBe("backend");
    expect(m.get("app/models/user.rb")).toBe("backend");
    expect(m.get("core/lib.rs")).toBe("backend");
  });

  it("seeds bin/, migrations and instrumentation files as backend", () => {
    const m = classifyFileLayers(
      ["bin/mcp.ts", "lib/migrations/0001_init.ts", "instrumentation.ts"],
      [],
    );
    expect(m.get("bin/mcp.ts")).toBe("backend");
    expect(m.get("lib/migrations/0001_init.ts")).toBe("backend");
    expect(m.get("instrumentation.ts")).toBe("backend");
  });

  it("leaves unseeded, unreferenced files null (neutral)", () => {
    const m = classifyFileLayers(["scripts/notes.ts", "README.md"], []);
    expect(m.get("scripts/notes.ts")).toBeNull();
    expect(m.get("README.md")).toBeNull();
  });
});

describe("classifyFileLayers — propagation along imports", () => {
  it("marks a plain .ts file imported by a frontend seed as frontend", () => {
    const m = classifyFileLayers(
      ["app/page.tsx", "lib/utils.ts"],
      [e("app/page.tsx", "lib/utils.ts")],
    );
    expect(m.get("lib/utils.ts")).toBe("frontend");
  });

  it("propagates transitively (seed → a → b)", () => {
    const m = classifyFileLayers(
      ["app/page.tsx", "lib/a.ts", "lib/b.ts"],
      [e("app/page.tsx", "lib/a.ts"), e("lib/a.ts", "lib/b.ts")],
    );
    expect(m.get("lib/b.ts")).toBe("frontend");
  });

  it("marks a file reachable from BOTH sides as fullstack", () => {
    const m = classifyFileLayers(
      ["app/page.tsx", "app/api/x/route.ts", "lib/shared.ts"],
      [e("app/page.tsx", "lib/shared.ts"), e("app/api/x/route.ts", "lib/shared.ts")],
    );
    expect(m.get("lib/shared.ts")).toBe("fullstack");
  });

  it("a seed keeps its seeded layer even when imported from the other side", () => {
    const m = classifyFileLayers(
      ["app/page.tsx", "app/api/x/route.ts"],
      [e("app/page.tsx", "app/api/x/route.ts")],
    );
    expect(m.get("app/api/x/route.ts")).toBe("backend");
  });

  it("survives import cycles", () => {
    const m = classifyFileLayers(
      ["app/page.tsx", "lib/a.ts", "lib/b.ts"],
      [e("app/page.tsx", "lib/a.ts"), e("lib/a.ts", "lib/b.ts"), e("lib/b.ts", "lib/a.ts")],
    );
    expect(m.get("lib/a.ts")).toBe("frontend");
    expect(m.get("lib/b.ts")).toBe("frontend");
  });

  it("is deterministic — same input, same result", () => {
    const paths = ["app/page.tsx", "app/api/x/route.ts", "lib/shared.ts", "lib/a.ts"];
    const edges = [
      e("app/page.tsx", "lib/shared.ts"),
      e("app/api/x/route.ts", "lib/shared.ts"),
      e("app/page.tsx", "lib/a.ts"),
    ];
    const m1 = classifyFileLayers(paths, edges);
    const m2 = classifyFileLayers([...paths].reverse(), [...edges].reverse());
    for (const p of paths) expect(m2.get(p)).toBe(m1.get(p)!);
  });
});
