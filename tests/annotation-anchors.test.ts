import { describe, expect, it } from "bun:test";
import { anchorAnnotations } from "@/lib/annotation-anchors";

// Canvas annotation pins: each plan annotation whose excerpt exactly names a board entity
// (table / table.column / METHOD path / feature title) anchors to that node so the boards
// can render a numbered pin + annotation card. Text-span annotations that match nothing
// stay panel-only. `n` is the 1-based position in the FULL annotations list so pin numbers
// agree with the Comments list ordering.

const tables = [
  { id: "t1", name: "auth_tokens", columns: ["id", "token_hash", "user_id", "expires_at"] },
  { id: "t2", name: "users", columns: ["id", "email"] },
];
const endpoints = [{ id: "e1", method: "POST", path: "/api/auth/login" }];
const features = [{ id: "f1", title: "Magic-link auth" }];

function anchor(excerpt: string) {
  return anchorAnnotations(
    [{ id: "a1", excerpt, comment: "x" }],
    { tables, endpoints, features },
  )[0];
}

describe("anchorAnnotations", () => {
  it("anchors an excerpt that exactly names a table", () => {
    expect(anchor("auth_tokens")).toEqual({
      annotationId: "a1",
      n: 1,
      kind: "table",
      targetId: "t1",
      column: null,
    });
  });

  it("anchors table.column excerpts to the column row", () => {
    expect(anchor("auth_tokens.expires_at")).toEqual({
      annotationId: "a1",
      n: 1,
      kind: "column",
      targetId: "t1",
      column: "expires_at",
    });
  });

  it("anchors endpoint excerpts (METHOD path)", () => {
    expect(anchor("POST /api/auth/login")).toMatchObject({ kind: "endpoint", targetId: "e1" });
  });

  it("anchors feature titles, with or without the 'feature:' prefix", () => {
    expect(anchor("Magic-link auth")).toMatchObject({ kind: "feature", targetId: "f1" });
    expect(anchor("feature: Magic-link auth")).toMatchObject({ kind: "feature", targetId: "f1" });
  });

  it("ignores prose excerpts that match nothing", () => {
    expect(anchor("Expire links after 15 min, not 24 h.")).toBeUndefined();
  });

  it("trims whitespace and keeps numbering aligned with the full list", () => {
    const anchors = anchorAnnotations(
      [
        { id: "a1", excerpt: "some prose the user highlighted", comment: "x" },
        { id: "a2", excerpt: "  auth_tokens.expires_at  ", comment: "y" },
        { id: "a3", excerpt: "users", comment: "z" },
      ],
      { tables, endpoints, features },
    );
    expect(anchors).toHaveLength(2);
    expect(anchors[0]).toMatchObject({ annotationId: "a2", n: 2, column: "expires_at" });
    expect(anchors[1]).toMatchObject({ annotationId: "a3", n: 3, kind: "table", targetId: "t2" });
  });

  it("a column name in a different table does not anchor", () => {
    expect(anchor("users.expires_at")).toBeUndefined();
  });
});
