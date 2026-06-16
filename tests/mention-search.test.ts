import { describe, expect, it } from "bun:test";
import { deriveFolders, mentionSearch, type MentionSources } from "@/lib/mention-search";

const sources: MentionSources = {
  files: [
    { path: "app/api/plan/route.ts" },
    { path: "components/plan/plan-workspace.tsx" },
    { path: "lib/db.ts" },
  ],
  features: [
    { id: "f1", title: "Plan review loop", cluster: "PLAN" },
    { id: "f2", title: "Polyglot code graph", cluster: "INTEL" },
  ],
  tables: [{ name: "PlanContract", domain: "PLAN" }, { name: "Node", domain: "DATA" }],
  endpoints: [{ id: "e1", method: "POST", path: "/api/plan", domain: "PLAN" }],
  notes: [{ id: "n1", title: "Planning ideas" }],
};

describe("deriveFolders", () => {
  it("expands file paths into their ancestor folders", () => {
    expect(deriveFolders(["a/b/c.ts", "a/d.ts"])).toEqual(["a", "a/b"]);
  });
});

describe("mentionSearch", () => {
  it("returns [] for an empty query", () => {
    expect(mentionSearch({ ...sources, folders: deriveFolders(sources.files.map((f) => f.path)) }, "")).toEqual([]);
  });

  it("finds matches across every kind for 'plan'", () => {
    const hits = mentionSearch(
      { ...sources, folders: deriveFolders(sources.files.map((f) => f.path)) },
      "plan",
    );
    const kinds = new Set(hits.map((h) => h.kind));
    expect(kinds.has("file")).toBe(true);
    expect(kinds.has("folder")).toBe(true);
    expect(kinds.has("feature")).toBe(true);
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("endpoint")).toBe(true);
    expect(kinds.has("note")).toBe(true);
    // a feature hit carries the id as ref so the chip links to the node
    const feat = hits.find((h) => h.kind === "feature");
    expect(feat?.ref).toBe("f1");
  });

  it("excludes non-matching entities", () => {
    const hits = mentionSearch(
      { ...sources, folders: deriveFolders(sources.files.map((f) => f.path)) },
      "polyglot",
    );
    expect(hits.every((h) => h.kind === "feature")).toBe(true);
    expect(hits[0].label).toBe("Polyglot code graph");
  });
});
