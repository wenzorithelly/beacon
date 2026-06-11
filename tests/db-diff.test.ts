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
    // Per-column statuses (keyed by the DRAFT column's name) drive row tinting on the card.
    expect(d.columns).toEqual({ verified: "added", email: "modified" });
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
