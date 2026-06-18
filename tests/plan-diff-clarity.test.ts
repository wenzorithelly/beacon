import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// graphToDoc is pure but its module imports the db layer — point BEACON_HOME at a throwaway dir.
process.env.BEACON_HOME = mkdtempSync(join(tmpdir(), "beacon-plan-diff-"));

const { graphToDoc } = await import("@/lib/draft-store");
const { diffDraftTables } = await import("@/lib/db-diff");
const { draftSchema } = await import("@/lib/design");

// The exact failure from the report: a plan that adds a UNIQUE constraint to merkle_roots
// re-declares the table for context but doesn't restate `nullable`/`isFk` per column. The board
// showed MODIFY + amber stripes on every NOT NULL column — changes the plan never proposed.
const REAL = [
  {
    name: "merkle_roots",
    columns: [
      { name: "id", type: "uuid", isPk: true, isFk: false, nullable: false },
      { name: "from_sequence", type: "bigint", isPk: false, isFk: false, nullable: false },
      { name: "anchor_provider", type: "varchar(32)", isPk: false, isFk: false, nullable: true },
      { name: "created_at", type: "timestamptz", isPk: false, isFk: false, nullable: false },
    ],
  },
];

const reDeclaration = draftSchema.parse({
  tables: [
    {
      name: "merkle_roots",
      columns: [
        { name: "id", type: "uuid", isPk: true }, // nullable omitted
        { name: "from_sequence", type: "bigint" }, // nullable omitted
        { name: "anchor_provider", type: "varchar(32)" }, // nullable omitted
        { name: "created_at", type: "timestamptz" }, // nullable omitted
      ],
    },
  ],
  relations: [],
  endpoints: [],
});

describe("plan-diff clarity — phantom MODIFY regression", () => {
  it("re-declaring an existing table (omitting nullable) inherits the live schema → NO column diff", () => {
    const doc = graphToDoc(reDeclaration, 1, 0, REAL);
    const diff = diffDraftTables(REAL, doc.tables).get(doc.tables[0].id)!;
    expect(diff.status).toBe("unchanged"); // "in plan", not MODIFY
    expect(diff.columns).toEqual({}); // no amber stripes
  });

  it("WITHOUT the live schema the same re-declaration fabricates phantom 'now nullable' edits", () => {
    // Documents the bug the inherit fixes: default nullable=true vs the live NOT NULL columns.
    const doc = graphToDoc(reDeclaration, 1); // realTables omitted
    const diff = diffDraftTables(REAL, doc.tables).get(doc.tables[0].id)!;
    expect(diff.status).toBe("modified");
    expect(diff.columns.from_sequence).toEqual({ kind: "modified", detail: "now nullable" });
    expect(diff.columns.created_at).toEqual({ kind: "modified", detail: "now nullable" });
    // anchor_provider IS nullable in the live schema, so even the buggy path leaves it alone.
    expect(diff.columns.anchor_provider).toBeUndefined();
  });

  it("a genuine retype still surfaces with its from→to detail (inherit doesn't mask real changes)", () => {
    const graph = draftSchema.parse({
      tables: [{ name: "merkle_roots", columns: [{ name: "from_sequence", type: "uuid" }] }],
      relations: [],
      endpoints: [],
    });
    const doc = graphToDoc(graph, 1, 0, REAL);
    const diff = diffDraftTables(REAL, doc.tables).get(doc.tables[0].id)!;
    expect(diff.status).toBe("modified");
    expect(diff.columns.from_sequence).toEqual({ kind: "modified", detail: "bigint→uuid" });
  });
});
