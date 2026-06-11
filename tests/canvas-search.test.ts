import { describe, expect, it } from "bun:test";
import {
  matchesQuery,
  roadmapHaystack,
  tableHaystack,
  endpointHaystack,
  fileHaystack,
  searchHits,
  type SearchHit,
} from "@/lib/canvas-search";

// Pure search logic shared by all four canvas tabs (roadmap, architecture, db, files).
// "Search whatever we want" = case-insensitive substring across EVERY text field of an
// entity, then rank by how well the visible label matches, capped. The canvas components
// turn the resulting hit ids into a spotlight (matches bright, rest dimmed).

describe("matchesQuery", () => {
  it("matches a substring case-insensitively across any field", () => {
    expect(matchesQuery(["User Profile", "AUTH"], "auth")).toBe(true);
    expect(matchesQuery(["User Profile", "AUTH"], "PROFILE")).toBe(true);
  });

  it("ignores null/undefined fields", () => {
    expect(matchesQuery([null, undefined, "users"], "user")).toBe(true);
    expect(matchesQuery([null, undefined], "user")).toBe(false);
  });

  it("returns false for an empty or whitespace-only query", () => {
    expect(matchesQuery(["anything"], "")).toBe(false);
    expect(matchesQuery(["anything"], "   ")).toBe(false);
  });

  it("does not match when the query is absent from every field", () => {
    expect(matchesQuery(["users", "auth"], "billing")).toBe(false);
  });
});

describe("field extractors", () => {
  it("roadmapHaystack matches on plain/role, not only title", () => {
    const node = {
      title: "Map client",
      role: "renders the roadmap canvas",
      plain: "lets you pan and zoom features",
      cluster: "UI",
      status: "DONE",
    };
    expect(matchesQuery(roadmapHaystack(node), "Map client")).toBe(true);
    expect(matchesQuery(roadmapHaystack(node), "pan and zoom")).toBe(true);
    expect(matchesQuery(roadmapHaystack(node), "renders")).toBe(true);
    expect(matchesQuery(roadmapHaystack(node), "ui")).toBe(true);
    expect(matchesQuery(roadmapHaystack(node), "done")).toBe(true);
    expect(matchesQuery(roadmapHaystack(node), "billing")).toBe(false);
  });

  it("tableHaystack matches on a column name, not only the table name", () => {
    const table = {
      name: "sessions",
      domain: "AUTH",
      description: "active login sessions",
      columns: [
        { name: "id", type: "text" },
        { name: "user_id", type: "text", note: "FK to users" },
      ],
    };
    expect(matchesQuery(tableHaystack(table), "sessions")).toBe(true);
    expect(matchesQuery(tableHaystack(table), "user_id")).toBe(true);
    expect(matchesQuery(tableHaystack(table), "FK to users")).toBe(true);
    expect(matchesQuery(tableHaystack(table), "auth")).toBe(true);
  });

  it("endpointHaystack matches on path and method", () => {
    const ep = { method: "POST", path: "/api/users", domain: "AUTH", description: "create a user" };
    expect(matchesQuery(endpointHaystack(ep), "/api/users")).toBe(true);
    expect(matchesQuery(endpointHaystack(ep), "post")).toBe(true);
    expect(matchesQuery(endpointHaystack(ep), "create a user")).toBe(true);
  });

  it("fileHaystack matches on path and language", () => {
    const f = { path: "lib/canvas-search.ts", lang: "ts" };
    expect(matchesQuery(fileHaystack(f), "canvas-search")).toBe(true);
    expect(matchesQuery(fileHaystack(f), "ts")).toBe(true);
    expect(matchesQuery(fileHaystack(f), "python")).toBe(false);
  });
});

describe("searchHits (filter + rank + cap)", () => {
  type Row = { id: string; name: string };
  const rows: Row[] = [
    { id: "1", name: "audit_users" },
    { id: "2", name: "user_roles" },
    { id: "3", name: "users" },
    { id: "4", name: "billing" },
  ];
  const toHaystack = (r: Row) => [r.name];
  const toHit = (r: Row): SearchHit => ({ id: r.id, label: r.name, kind: "table" });

  it("returns nothing for an empty query", () => {
    expect(searchHits(rows, "", toHaystack, toHit)).toEqual([]);
  });

  it("keeps only matching rows", () => {
    const hits = searchHits(rows, "user", toHaystack, toHit);
    expect(hits.map((h) => h.id).sort()).toEqual(["1", "2", "3"]);
  });

  it("ranks an exact label match first, then prefix, then substring", () => {
    const hits = searchHits(rows, "user", toHaystack, toHit);
    // "users" (exact) → "user_roles" (prefix) → "audit_users" (substring)
    expect(hits.map((h) => h.id)).toEqual(["3", "2", "1"]);
  });

  it("caps the number of results", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: `user_${i}` }));
    const hits = searchHits(many, "user", toHaystack, toHit, 12);
    expect(hits.length).toBe(12);
  });
});
