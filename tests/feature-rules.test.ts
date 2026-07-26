import { describe, expect, it } from "bun:test";
import {
  MIN_DESCRIPTION_CHARS,
  describedEnough,
  existingCategories,
  validateFeatureCreation,
  validateFront,
  validateNoDuplicateFeatures,
  validateProposedFeatures,
} from "@/lib/feature-rules";

const ROADMAP = [
  { id: "f1", title: "Expand corpus coverage", cluster: "DATA", status: "PENDING" },
  { id: "f2", title: "Harden auth and admin access", cluster: "AUTH", status: "DONE" },
];

// A description that clears MIN_DESCRIPTION_CHARS, so the tests below exercise the rule they name
// instead of all tripping the description gate. Every fixture that is SUPPOSED to pass carries it.
const DESC =
  "Adds the thing this card is about, why it matters for the board, and the files it touches.";

describe("validateProposedFeatures", () => {
  it("passes when every feature has a category + priority + description", () => {
    expect(
      validateProposedFeatures([
        { title: "Auth", cluster: "AUTH", priority: 1, description: DESC },
        { title: "Search", cluster: "SEARCH", priority: 2, description: DESC },
      ]),
    ).toBeNull();
  });

  it("accepts priority 0 (P0) — it is set, not missing", () => {
    expect(
      validateProposedFeatures([{ title: "Critical", cluster: "DATA", priority: 0, description: DESC }]),
    ).toBeNull();
  });

  it("passes for an empty plan (no features)", () => {
    expect(validateProposedFeatures([])).toBeNull();
  });

  it("flags a feature missing its category", () => {
    const err = validateProposedFeatures([{ title: "Search", priority: 2, description: DESC }]);
    expect(err).toContain("Search");
    expect(err).toContain("category");
    expect(err).not.toContain("priority +"); // only category is missing
  });

  it("treats a blank/whitespace category as missing", () => {
    const err = validateProposedFeatures([
      { title: "Search", cluster: "   ", priority: 2, description: DESC },
    ]);
    expect(err).toContain("category");
  });

  it("flags a feature missing its priority", () => {
    const err = validateProposedFeatures([{ title: "Search", cluster: "SEARCH", description: DESC }]);
    expect(err).toContain("priority");
  });

  it("flags a feature missing its description", () => {
    const err = validateProposedFeatures([{ title: "Search", cluster: "SEARCH", priority: 2 }])!;
    expect(err).toContain("Search");
    expect(err).toContain("description");
  });

  it("flags a description that exists but is too thin, naming the shortfall", () => {
    const err = validateProposedFeatures([
      { title: "Search", cluster: "SEARCH", priority: 2, description: "TBD" },
    ])!;
    // "missing description" would tell the agent to add a field it already sent — say EXPAND.
    expect(err).toContain("fuller description");
    expect(err).toContain("3 chars");
    expect(err).toContain(String(MIN_DESCRIPTION_CHARS));
  });

  it("treats a whitespace-only description as missing", () => {
    const err = validateProposedFeatures([
      { title: "Search", cluster: "SEARCH", priority: 2, description: "        \n   " },
    ])!;
    expect(err).toContain("description");
  });

  it("flags all three when a feature has none of them", () => {
    const err = validateProposedFeatures([{ title: "Bare" }]);
    expect(err).toContain("category + priority + description");
  });

  it("lists only the incomplete features", () => {
    const err = validateProposedFeatures([
      { title: "Good", cluster: "AUTH", priority: 1, description: DESC },
      { title: "Bad", cluster: "", priority: null },
    ]);
    expect(err).toContain("Bad");
    expect(err).not.toContain('"Good"');
  });

  it("does not require layer by default", () => {
    expect(
      validateProposedFeatures([{ title: "API", cluster: "DATA", priority: 1, description: DESC }]),
    ).toBeNull();
  });

  it("requires layer when requireLayer is set, naming the valid values", () => {
    const err = validateProposedFeatures(
      [{ title: "API", cluster: "DATA", priority: 1, description: DESC }],
      { requireLayer: true },
    )!;
    expect(err).toContain("API");
    expect(err).toContain("layer");
    expect(err).toContain("frontend");
    expect(err).toContain("backend");
    expect(err).toContain("fullstack");
  });

  it("treats an invalid layer value as missing when required", () => {
    const err = validateProposedFeatures(
      [{ title: "API", cluster: "DATA", priority: 1, layer: "middleware", description: DESC }],
      { requireLayer: true },
    );
    expect(err).toContain("layer");
  });

  it("passes with a valid (case-tolerant) layer when required", () => {
    expect(
      validateProposedFeatures(
        [
          { title: "API", cluster: "DATA", priority: 1, layer: "backend", description: DESC },
          { title: "Screen", cluster: "UI", priority: 2, layer: "Frontend", description: DESC },
        ],
        { requireLayer: true },
      ),
    ).toBeNull();
  });
});

describe("describedEnough", () => {
  it("accepts a description at exactly the minimum", () => {
    expect(describedEnough({ title: "x", description: "y".repeat(MIN_DESCRIPTION_CHARS) })).toBe(true);
  });
  it("rejects one character short", () => {
    expect(describedEnough({ title: "x", description: "y".repeat(MIN_DESCRIPTION_CHARS - 1) })).toBe(false);
  });
  it("rejects missing and blank", () => {
    expect(describedEnough({ title: "x" })).toBe(false);
    expect(describedEnough({ title: "x", description: "   " })).toBe(false);
  });
});

describe("existingCategories", () => {
  it("returns sorted, unique, non-empty categories", () => {
    expect(existingCategories(ROADMAP)).toEqual(["AUTH", "DATA"]);
  });
  it("ignores blank/null categories", () => {
    expect(existingCategories([{ id: "x", title: "x", cluster: null }, { id: "y", title: "y", cluster: " " }])).toEqual([]);
  });
});

describe("validateFeatureCreation", () => {
  it("passes for a fresh, categorized, described, non-duplicate feature", () => {
    expect(
      validateFeatureCreation({
        title: "Redis rate limiting",
        category: "INFRA",
        description: DESC,
        existing: ROADMAP,
      }),
    ).toBeNull();
  });

  it("rejects a feature with no category and surfaces categories to reuse", () => {
    const err = validateFeatureCreation({
      title: "Redis rate limiting",
      category: "",
      description: DESC,
      existing: ROADMAP,
    })!;
    expect(err).toContain("category");
    expect(err).toContain("AUTH");
    expect(err).toContain("DATA");
  });

  it("rejects a feature with no description, pointing at `description`", () => {
    const err = validateFeatureCreation({
      title: "Redis rate limiting",
      category: "INFRA",
      existing: ROADMAP,
    })!;
    expect(err).toContain("no description");
    expect(err).toContain("`description`");
    expect(err).toContain(String(MIN_DESCRIPTION_CHARS));
  });

  it("rejects a too-thin description, naming its length", () => {
    const err = validateFeatureCreation({
      title: "Redis rate limiting",
      category: "INFRA",
      description: "later",
      existing: ROADMAP,
    })!;
    expect(err).toContain("5-char description");
  });

  it("checks description LAST — a duplicate is reported before the missing body", () => {
    // Writing 80 characters about a card that already exists wastes the write, so every cheaper
    // rejection must fire first.
    const err = validateFeatureCreation({
      title: "Expand corpus coverage",
      category: "DATA",
      existing: ROADMAP,
    })!;
    expect(err.toLowerCase()).toContain("already");
    expect(err).not.toContain("description");
  });

  it("blocks a near-duplicate of an existing feature, naming it + its status", () => {
    const err = validateFeatureCreation({
      title: "Expand corpus coverage",
      category: "DATA",
      description: DESC,
      existing: ROADMAP,
    })!;
    expect(err).toContain("Expand corpus coverage");
    expect(err.toLowerCase()).toContain("already");
    expect(err).toContain("PENDING");
  });

  it("allows a genuinely different title in the same category", () => {
    expect(
      validateFeatureCreation({
        title: "Stripe billing webhooks",
        category: "DATA",
        description: DESC,
        existing: ROADMAP,
      }),
    ).toBeNull();
  });

  it("allows a SAME-title feature in a different category", () => {
    // "Expand corpus coverage" exists in DATA — the same title under SEARCH is a distinct card.
    expect(
      validateFeatureCreation({
        title: "Expand corpus coverage",
        category: "SEARCH",
        description: DESC,
        existing: ROADMAP,
      }),
    ).toBeNull();
  });

  it("allows a SAME-title + same-category feature on a different layer", () => {
    const existing = [
      { id: "x", title: "Search", cluster: "SEARCH", layer: "backend", status: "PENDING" },
    ];
    expect(
      validateFeatureCreation({
        title: "Search",
        category: "SEARCH",
        layer: "frontend",
        description: DESC,
        existing,
      }),
    ).toBeNull();
  });

  it("still blocks an exact duplicate (same title + category + layer)", () => {
    const existing = [
      { id: "x", title: "Search", cluster: "SEARCH", layer: "backend", status: "PENDING" },
    ];
    const err = validateFeatureCreation({
      title: "Search",
      category: "SEARCH",
      layer: "backend",
      description: DESC,
      existing,
    })!;
    expect(err.toLowerCase()).toContain("already");
  });

  it("rejects a blank title", () => {
    expect(
      validateFeatureCreation({ title: "   ", category: "DATA", description: DESC, existing: ROADMAP }),
    ).toContain("title");
  });

  it("requires layer only when requireLayer is set", () => {
    expect(
      validateFeatureCreation({
        title: "Stripe billing webhooks",
        category: "INFRA",
        description: DESC,
        existing: ROADMAP,
      }),
    ).toBeNull();
    const err = validateFeatureCreation({
      title: "Stripe billing webhooks",
      category: "INFRA",
      description: DESC,
      requireLayer: true,
      existing: ROADMAP,
    })!;
    expect(err).toContain("layer");
    expect(err).toContain("fullstack");
  });

  it("passes with a valid layer when required", () => {
    expect(
      validateFeatureCreation({
        title: "Stripe billing webhooks",
        category: "INFRA",
        layer: "backend",
        description: DESC,
        requireLayer: true,
        existing: ROADMAP,
      }),
    ).toBeNull();
  });
});

describe("validateNoDuplicateFeatures", () => {
  it("passes when no proposed feature matches an existing one", () => {
    expect(validateNoDuplicateFeatures([{ title: "Stripe billing webhooks" }], ROADMAP)).toBeNull();
  });
  it("flags only the proposed feature that duplicates an existing one (same category)", () => {
    const err = validateNoDuplicateFeatures(
      [
        { title: "Expand corpus coverage", cluster: "DATA" },
        { title: "Stripe billing webhooks", cluster: "DATA" },
      ],
      ROADMAP,
    )!;
    expect(err).toContain("Expand corpus coverage");
    expect(err).not.toContain("Stripe");
  });

  it("ALLOWS a same-title feature in a DIFFERENT category", () => {
    // "Expand corpus coverage" exists in DATA; the same title under SEARCH is a distinct card.
    expect(
      validateNoDuplicateFeatures([{ title: "Expand corpus coverage", cluster: "SEARCH" }], ROADMAP),
    ).toBeNull();
  });

  it("ALLOWS a same-title + same-category feature on a DIFFERENT layer", () => {
    const existing = [
      { id: "x", title: "Search", cluster: "SEARCH", layer: "backend", status: "PENDING" },
    ];
    expect(
      validateNoDuplicateFeatures([{ title: "Search", cluster: "SEARCH", layer: "frontend" }], existing),
    ).toBeNull();
  });

  it("still blocks an exact duplicate (same title + category + layer)", () => {
    const existing = [
      { id: "x", title: "Search", cluster: "SEARCH", layer: "backend", status: "PENDING" },
    ];
    const err = validateNoDuplicateFeatures(
      [{ title: "Search", cluster: "SEARCH", layer: "backend" }],
      existing,
    )!;
    expect(err).toContain("Search");
  });
});

describe("validateFront", () => {
  const fronts = [{ id: "f1", title: "Expand corpus coverage" }];
  it("passes when front references an existing feature", () => {
    expect(validateFront("Expand corpus coverage", fronts)).toBeNull();
  });
  it("rejects a bare domain-tag front that matches no feature, steering to category", () => {
    const err = validateFront("CRAWL", fronts)!;
    expect(err).toContain("CRAWL");
    expect(err).toContain("category");
  });
});
