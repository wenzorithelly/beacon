import { describe, expect, it } from "bun:test";
import {
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

describe("validateProposedFeatures", () => {
  it("passes when every feature has a category + priority", () => {
    expect(
      validateProposedFeatures([
        { title: "Auth", cluster: "AUTH", priority: 1 },
        { title: "Search", cluster: "SEARCH", priority: 2 },
      ]),
    ).toBeNull();
  });

  it("accepts priority 0 (P0) — it is set, not missing", () => {
    expect(validateProposedFeatures([{ title: "Critical", cluster: "DATA", priority: 0 }])).toBeNull();
  });

  it("passes for an empty plan (no features)", () => {
    expect(validateProposedFeatures([])).toBeNull();
  });

  it("flags a feature missing its category", () => {
    const err = validateProposedFeatures([{ title: "Search", priority: 2 }]);
    expect(err).toContain("Search");
    expect(err).toContain("category");
    expect(err).not.toContain("priority +"); // only category is missing
  });

  it("treats a blank/whitespace category as missing", () => {
    const err = validateProposedFeatures([{ title: "Search", cluster: "   ", priority: 2 }]);
    expect(err).toContain("category");
  });

  it("flags a feature missing its priority", () => {
    const err = validateProposedFeatures([{ title: "Search", cluster: "SEARCH" }]);
    expect(err).toContain("priority");
  });

  it("flags both when a feature has neither", () => {
    const err = validateProposedFeatures([{ title: "Bare" }]);
    expect(err).toContain("category + priority");
  });

  it("lists only the incomplete features", () => {
    const err = validateProposedFeatures([
      { title: "Good", cluster: "AUTH", priority: 1 },
      { title: "Bad", cluster: "", priority: null },
    ]);
    expect(err).toContain("Bad");
    expect(err).not.toContain('"Good"');
  });

  it("does not require layer by default", () => {
    expect(validateProposedFeatures([{ title: "API", cluster: "DATA", priority: 1 }])).toBeNull();
  });

  it("requires layer when requireLayer is set, naming the valid values", () => {
    const err = validateProposedFeatures([{ title: "API", cluster: "DATA", priority: 1 }], {
      requireLayer: true,
    })!;
    expect(err).toContain("API");
    expect(err).toContain("layer");
    expect(err).toContain("frontend");
    expect(err).toContain("backend");
    expect(err).toContain("fullstack");
  });

  it("treats an invalid layer value as missing when required", () => {
    const err = validateProposedFeatures(
      [{ title: "API", cluster: "DATA", priority: 1, layer: "middleware" }],
      { requireLayer: true },
    );
    expect(err).toContain("layer");
  });

  it("passes with a valid (case-tolerant) layer when required", () => {
    expect(
      validateProposedFeatures(
        [
          { title: "API", cluster: "DATA", priority: 1, layer: "backend" },
          { title: "Screen", cluster: "UI", priority: 2, layer: "Frontend" },
        ],
        { requireLayer: true },
      ),
    ).toBeNull();
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
  it("passes for a fresh, categorized, non-duplicate feature", () => {
    expect(
      validateFeatureCreation({ title: "Redis rate limiting", category: "INFRA", existing: ROADMAP }),
    ).toBeNull();
  });

  it("rejects a feature with no category and surfaces categories to reuse", () => {
    const err = validateFeatureCreation({ title: "Redis rate limiting", category: "", existing: ROADMAP })!;
    expect(err).toContain("category");
    expect(err).toContain("AUTH");
    expect(err).toContain("DATA");
  });

  it("blocks a near-duplicate of an existing feature, naming it + its status", () => {
    const err = validateFeatureCreation({ title: "Expand corpus coverage", category: "DATA", existing: ROADMAP })!;
    expect(err).toContain("Expand corpus coverage");
    expect(err.toLowerCase()).toContain("already");
    expect(err).toContain("PENDING");
  });

  it("allows a genuinely different title in the same category", () => {
    expect(
      validateFeatureCreation({ title: "Stripe billing webhooks", category: "DATA", existing: ROADMAP }),
    ).toBeNull();
  });

  it("rejects a blank title", () => {
    expect(validateFeatureCreation({ title: "   ", category: "DATA", existing: ROADMAP })).toContain("title");
  });

  it("requires layer only when requireLayer is set", () => {
    expect(
      validateFeatureCreation({ title: "Stripe billing webhooks", category: "INFRA", existing: ROADMAP }),
    ).toBeNull();
    const err = validateFeatureCreation({
      title: "Stripe billing webhooks",
      category: "INFRA",
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
  it("flags only the proposed feature that duplicates an existing one", () => {
    const err = validateNoDuplicateFeatures(
      [{ title: "Expand corpus coverage" }, { title: "Stripe billing webhooks" }],
      ROADMAP,
    )!;
    expect(err).toContain("Expand corpus coverage");
    expect(err).not.toContain("Stripe");
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
