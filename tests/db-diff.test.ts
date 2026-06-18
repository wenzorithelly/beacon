import { describe, expect, it } from "bun:test";
import { diffDraftTables, diffDraftEndpoints } from "@/lib/db-diff";

const col = (name: string, type = "text", extra: Partial<{ isPk: boolean; isFk: boolean; nullable: boolean }> = {}) => ({
  name,
  type,
  isPk: extra.isPk ?? false,
  isFk: extra.isFk ?? false,
  nullable: extra.nullable ?? true,
});

describe("diffDraftTables", () => {
  it("marks a draft table with no real match as 'added'", () => {
    const m = diffDraftTables([], [{ id: "d1", name: "users", columns: [col("id", "uuid", { isPk: true })] }]);
    expect(m.get("d1")).toEqual({ status: "added", changes: ["new table"], columns: {} });
  });

  it("marks a draft table identical to the real one as 'unchanged'", () => {
    const cols = [col("id", "uuid", { isPk: true, nullable: false })];
    const m = diffDraftTables([{ name: "users", columns: cols }], [{ id: "d1", name: "users", columns: cols }]);
    expect(m.get("d1")).toEqual({ status: "unchanged", changes: [], columns: {} });
  });

  it("detects added / removed / changed columns as 'modified' with a change list", () => {
    const real = [
      {
        name: "users",
        columns: [col("id", "uuid", { isPk: true }), col("email", "text", { nullable: false }), col("legacy")],
      },
    ];
    const draft = [
      {
        id: "d1",
        name: "users",
        columns: [col("id", "uuid", { isPk: true }), col("email", "citext", { nullable: false }), col("verified", "boolean")],
      },
    ];
    const d = diffDraftTables(real, draft).get("d1")!;
    expect(d.status).toBe("modified");
    expect(d.changes).toContain("+ column verified (boolean)");
    expect(d.changes).toContain("- column legacy");
    expect(d.changes.some((c) => c.startsWith("~ column email"))).toBe(true);
    // Per-column entries (keyed by the DRAFT column's name) drive row tinting AND the inline
    // delta chip — each carries the from→to detail, not just an opaque status.
    expect(d.columns).toEqual({
      verified: { kind: "added", detail: "new column" },
      email: { kind: "modified", detail: "text→citext" },
    });
  });

  it("carries a compact from→to detail per modified column (type, nullable, key flips)", () => {
    const real = [
      {
        name: "merkle_roots",
        columns: [
          col("seq", "bigint", { nullable: false }),
          col("hash", "text", { nullable: false }),
          col("ref", "text"),
        ],
      },
    ];
    const draft = [
      {
        id: "d1",
        name: "merkle_roots",
        columns: [
          col("seq", "uuid", { nullable: false }), // retype
          col("hash", "text", { nullable: true }), // now nullable
          col("ref", "text", { isPk: true }), // now PK
        ],
      },
    ];
    const d = diffDraftTables(real, draft).get("d1")!;
    expect(d.columns).toEqual({
      seq: { kind: "modified", detail: "bigint→uuid" }, // type change shows old→new inline
      hash: { kind: "modified", detail: "now nullable" },
      ref: { kind: "modified", detail: "now PK" },
    });
  });

  it("matches table + column names case-insensitively", () => {
    const m = diffDraftTables(
      [{ name: "Users", columns: [col("ID", "uuid", { isPk: true, nullable: false })] }],
      [{ id: "d1", name: "users", columns: [col("id", "uuid", { isPk: true, nullable: false })] }],
    );
    expect(m.get("d1")!.status).toBe("unchanged");
  });
});

describe("diffDraftEndpoints", () => {
  it("marks a draft endpoint with no real match as 'added'", () => {
    const m = diffDraftEndpoints([], [{ id: "e1", method: "POST", path: "/users" }]);
    expect(m.get("e1")).toEqual({ status: "added", changes: ["new endpoint"], columns: {} });
  });

  it("marks a draft endpoint matching a real one (method+path, case-insensitive) as 'unchanged'", () => {
    const m = diffDraftEndpoints([{ method: "GET", path: "/users" }], [{ id: "e1", method: "get", path: "/users" }]);
    expect(m.get("e1")!.status).toBe("unchanged");
  });
});
