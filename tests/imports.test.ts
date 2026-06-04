import { describe, expect, it } from "bun:test";
import { extractImports, importGraphText } from "@/intel/extractors/imports";

describe("extractImports", () => {
  it("resolves relative imports to internal files; bare specifiers → external pkgs", () => {
    const files = [
      {
        path: "src/api/orders.ts",
        content: 'import { pool } from "../db/models";\nimport Stripe from "stripe";',
      },
      { path: "src/db/models.ts", content: 'import { Pool } from "pg";' },
    ];
    const r = extractImports(files);
    const orders = r.find((x) => x.path === "src/api/orders.ts")!;
    expect(orders.internal).toContain("src/db/models.ts");
    expect(orders.external).toContain("stripe");
    expect(r.find((x) => x.path === "src/db/models.ts")!.external).toContain("pg");
  });

  it("handles python imports (dotted internal + external)", () => {
    const files = [
      { path: "app/api.py", content: "from app.db import session\nimport fastapi" },
      { path: "app/db.py", content: "" },
    ];
    const api = extractImports(files).find((x) => x.path === "app/api.py")!;
    expect(api.internal).toContain("app/db.py");
    expect(api.external).toContain("fastapi");
  });

  it("renders a compact graph line", () => {
    const txt = importGraphText([
      { path: "a.ts", internal: ["b.ts"], external: ["express"] },
      { path: "c.ts", internal: [], external: [] },
    ]);
    expect(txt).toContain("a.ts -> imports: b.ts | pkgs: express");
    expect(txt).not.toContain("c.ts");
  });
});
