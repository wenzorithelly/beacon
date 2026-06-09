import { describe, expect, it } from "bun:test";
import { extractBeaconBlock, mentionsDbSchema } from "@/lib/plan-block";

// Build a plan with an embedded ```beacon block from a JSON payload.
function planWith(payload: unknown): string {
  return [
    "# Plan: do the thing",
    "",
    "Here is the prose the user actually reads.",
    "",
    "## Database",
    "```beacon",
    JSON.stringify(payload),
    "```",
    "",
    "Closing prose.",
  ].join("\n");
}

describe("extractBeaconBlock", () => {
  it("parses tables + features and strips the block from the prose", () => {
    const md = planWith({
      tables: [{ name: "pr_orgs", columns: [{ name: "id", type: "UUID", isPk: true }] }],
      features: [{ title: "Org management" }],
    });
    const out = extractBeaconBlock(md);

    expect(out.draft?.tables.length).toBe(1);
    expect(out.draft?.tables[0].name).toBe("pr_orgs");
    expect(out.features?.length).toBe(1);
    expect(out.features?.[0].title).toBe("Org management");

    // The raw block + JSON must be GONE from the prose the annotation panel renders.
    expect(out.prose).not.toContain("```beacon");
    expect(out.prose).not.toContain("pr_orgs");
    expect(out.prose).toContain("Here is the prose the user actually reads.");
    expect(out.prose).toContain("Closing prose.");
  });

  it("returns the markdown unchanged when there is no block", () => {
    const md = "# Plan\n\nJust prose, no structured block.";
    const out = extractBeaconBlock(md);
    expect(out.draft).toBeUndefined();
    expect(out.features).toBeUndefined();
    expect(out.prose).toBe(md);
  });

  it("degrades to unchanged prose when the block is malformed JSON", () => {
    const md = ["# Plan", "```beacon", "{ not valid json,,, }", "```"].join("\n");
    const out = extractBeaconBlock(md);
    expect(out.draft).toBeUndefined();
    expect(out.features).toBeUndefined();
    expect(out.prose).toBe(md);
  });

  it("handles a features-only block (no DB draft)", () => {
    const md = planWith({ features: [{ title: "Just a feature" }] });
    const out = extractBeaconBlock(md);
    expect(out.draft).toBeUndefined();
    expect(out.features?.[0].title).toBe("Just a feature");
    expect(out.prose).not.toContain("```beacon");
  });

  it("handles a tables-only block (no features) including endpoints + relations", () => {
    const md = planWith({
      tables: [
        { name: "a", columns: [{ name: "id", type: "UUID", isPk: true }] },
        { name: "b", columns: [{ name: "a_id", type: "UUID", isFk: true }] },
      ],
      relations: [{ fromTable: "b", fromColumn: "a_id", toTable: "a", toColumn: "id" }],
      endpoints: [{ method: "POST", path: "/api/a", uses: [{ table: "a" }] }],
    });
    const out = extractBeaconBlock(md);
    expect(out.features).toBeUndefined();
    expect(out.draft?.tables.length).toBe(2);
    expect(out.draft?.relations.length).toBe(1);
    expect(out.draft?.endpoints.length).toBe(1);
    // access defaults from the verb (POST → write) via draftSchema's transform.
    expect(out.draft?.endpoints[0].uses[0].access).toBe("write");
  });

  it("leaves prose untouched when the block has no usable content", () => {
    const md = planWith({ tables: [], features: [] });
    const out = extractBeaconBlock(md);
    expect(out.draft).toBeUndefined();
    expect(out.features).toBeUndefined();
    expect(out.prose).toBe(md);
  });

  it("strips a multi-line, pretty-printed block (the real ExitPlanMode shape)", () => {
    // The ExitPlanMode hook embeds the block as indented, pretty-printed JSON spanning many
    // lines — NOT the single-line JSON.stringify the other cases use. The non-greedy
    // [\s\S]*? body must still capture it and the closing fence must still match.
    const md = [
      "# Harden auth/admin",
      "",
      "## Schema changes (3 migrations)",
      "Add the models, then run `make migrate`.",
      "",
      "```beacon",
      "{",
      '  "features": [',
      '    { "title": "Refresh token rotation & revocation", "cluster": "AUTH" },',
      '    { "title": "Email verification (track-only)", "cluster": "AUTH" }',
      "  ],",
      '  "tables": [',
      '    { "name": "refresh_tokens", "domain": "AUTH", "columns": [',
      '      { "name": "id", "type": "uuid", "isPk": true },',
      '      { "name": "user_id", "type": "uuid", "isFk": true }',
      "    ]}",
      "  ],",
      '  "relations": [',
      '    { "fromTable": "refresh_tokens", "fromColumn": "user_id", "toTable": "users", "toColumn": "id" }',
      "  ],",
      '  "endpoints": [',
      '    { "method": "POST", "path": "/api/v1/auth/refresh", "uses": [ { "table": "refresh_tokens", "access": "read/write" } ] }',
      "  ]",
      "}",
      "```",
      "",
      "## Verification",
      "Run `make test`.",
    ].join("\n");

    const out = extractBeaconBlock(md);

    expect(out.draft?.tables.length).toBe(1);
    expect(out.draft?.tables[0].name).toBe("refresh_tokens");
    expect(out.draft?.relations.length).toBe(1);
    expect(out.draft?.endpoints.length).toBe(1);
    expect(out.draft?.endpoints[0].uses[0].access).toBe("read/write");
    expect(out.features?.length).toBe(2);

    // The machine-only JSON must be GONE; the surrounding prose must remain.
    expect(out.prose).not.toContain("```beacon");
    expect(out.prose).not.toContain("refresh_tokens");
    expect(out.prose).not.toContain('"features"');
    expect(out.prose).toContain("## Schema changes (3 migrations)");
    expect(out.prose).toContain("## Verification");
  });
});

describe("mentionsDbSchema", () => {
  it("detects real schema language (drives the propose_plan hard block)", () => {
    expect(mentionsDbSchema("Model `app/models/legal_precedent.py` — LegalPrecedent(BaseModel)")).toBe(true);
    expect(mentionsDbSchema("natural key (court, type) with UniqueConstraint; canonical_payload JSONB")).toBe(true);
    expect(mentionsDbSchema("run `make revision` then the Alembic migration")).toBe(true);
    expect(mentionsDbSchema("add a pgvector column + TSVECTOR index")).toBe(true);
    expect(mentionsDbSchema("source_id FK → users")).toBe(true);
  });

  it("does not fire on generic prose (avoids false blocks)", () => {
    expect(mentionsDbSchema("Refactor the React components and improve the UI copy.")).toBe(false);
    expect(mentionsDbSchema("Add a settings page with a dropdown.")).toBe(false);
    expect(mentionsDbSchema("")).toBe(false);
    expect(mentionsDbSchema(null)).toBe(false);
  });
});

describe("extractBeaconBlock — tolerant of common agent format variations", () => {
  it("normalizes the category alias (`category`/`domain`) to cluster", () => {
    const out = extractBeaconBlock(
      planWith({ features: [{ title: "Norm", category: "DATA", priority: 1 }] }),
    );
    expect(out.features?.[0]?.cluster).toBe("DATA");
  });

  it("clamps an off-scale priority into 0..3 instead of dropping the feature", () => {
    const out = extractBeaconBlock(planWith({ features: [{ title: "Low", cluster: "X", priority: 4 }] }));
    expect(out.features?.[0]?.priority).toBe(3);
  });

  it("coerces bare-string columns so the table still renders", () => {
    const out = extractBeaconBlock(
      planWith({ tables: [{ name: "legal_types", columns: ["id", "code", "created_at"] }] }),
    );
    expect(out.draft?.tables?.[0]?.columns).toHaveLength(3);
    expect(out.draft?.tables?.[0]?.columns?.[0]).toEqual({ name: "id", type: "text" });
  });

  it("keeps valid tables + features even when relations are in a bad shape (per-item tolerance)", () => {
    const out = extractBeaconBlock(
      planWith({
        features: [{ title: "F", cluster: "DATA", priority: 2 }],
        tables: [{ name: "t", columns: ["id"] }],
        relations: [{ from: "t.a", to: "u.b" }], // wrong shape — must be skipped, not fatal
      }),
    );
    expect(out.draft?.tables).toHaveLength(1);
    expect(out.features).toHaveLength(1);
    expect(out.draft?.relations).toHaveLength(0);
    expect(out.prose).not.toContain("```beacon"); // block still stripped
  });

  it("drops only the malformed feature, keeps the good ones", () => {
    const out = extractBeaconBlock(
      planWith({
        features: [
          { title: "Good", cluster: "DATA", priority: 1 },
          { cluster: "DATA", priority: 1 }, // no title — invalid, skipped
        ],
      }),
    );
    expect(out.features).toHaveLength(1);
    expect(out.features?.[0]?.title).toBe("Good");
  });
});
