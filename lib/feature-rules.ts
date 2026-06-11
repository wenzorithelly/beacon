// Shared rule for proposed roadmap features: a feature node is only useful on the board if it
// carries a category (cluster) and a priority — they drive grouping + ordering, and the user
// shouldn't have to add them by hand every time. The propose-plan flow therefore REQUIRES both
// and rejects a plan missing either, the same gate idea as "a DB plan must ship structured
// tables". Pure (no db / no fs import) so BOTH the MCP server process and the /api/plan route
// can call it.

import { normalizeLayer } from "@/lib/layer";
import { matchFeature, type Candidate } from "@/lib/match";

export interface FeatureLike {
  title: string;
  cluster?: string | null;
  // The agent + UI both call this "category", and "domain" is the adjacent word it reaches for.
  // Accept all three as the same thing so a plan written with `category` isn't falsely rejected.
  category?: string | null;
  domain?: string | null;
  priority?: number | null;
  layer?: string | null;
}

// The feature's category, accepting the `cluster` / `category` / `domain` aliases.
export function featureCategory(f: FeatureLike): string | null {
  return f.cluster ?? f.category ?? f.domain ?? null;
}

// Returns an agent-facing rejection message when any feature is missing its category/priority
// (and, when the workspace has a frontend, its layer), or null when every feature is complete.
export function validateProposedFeatures(
  features: FeatureLike[],
  opts?: { requireLayer?: boolean },
): string | null {
  const requireLayer = opts?.requireLayer ?? false;
  const gaps = features
    .map((f) => {
      const missing: string[] = [];
      const category = featureCategory(f);
      if (!category || !category.trim()) missing.push("category");
      if (f.priority == null) missing.push("priority");
      if (requireLayer && !normalizeLayer(f.layer)) missing.push("layer");
      return missing.length
        ? `  • "${f.title?.trim() || "(untitled)"}" — missing ${missing.join(" + ")}`
        : null;
    })
    .filter((x): x is string => x !== null);
  if (gaps.length === 0) return null;
  const layerRule = requireLayer
    ? " This workspace has a frontend surface, so every feature must also carry `layer`: " +
      '"frontend" | "backend" | "fullstack" — which side of the stack the work lands on.'
    : "";
  return (
    "⛔ Every roadmap feature needs a category AND a priority — they drive grouping and ordering " +
    "on the board, and the user shouldn't have to add them by hand." +
    layerRule +
    " Missing:\n" +
    gaps.join("\n") +
    "\n\nRe-present with each feature carrying its category as `category` (or `cluster` — both " +
    "work; e.g. AUTH, SEARCH, DATA, INTEL, BILLING …) and `priority` (0 = P0 critical, 1 = P1 " +
    "high, 2 = P2 medium, 3 = P3 low)." +
    (requireLayer ? " Set `layer` on EVERY feature too." : "") +
    " Don't rely on defaults."
  );
}

export interface ExistingFeature {
  id: string;
  title: string;
  cluster?: string | null;
  status?: string | null;
}

/** Sorted, unique, non-empty category (cluster) names already on the roadmap — surfaced to the
 *  agent so it reuses an existing category instead of inventing a near-synonym. */
export function existingCategories(features: ExistingFeature[]): string[] {
  const set = new Set<string>();
  for (const f of features) {
    const c = (f.cluster ?? "").trim();
    if (c) set.add(c);
  }
  return [...set].sort();
}

/** Guard for creating a SINGLE roadmap feature on the loose paths (start_feature / add_subtasks),
 *  mirroring the propose_plan gate: a feature must carry a category and must not duplicate an
 *  existing one. Returns an agent-facing rejection message, or null when it's safe to create.
 *  Pure (no db) so the route + the MCP process share one rule. */
export function validateFeatureCreation(input: {
  title: string;
  category?: string | null;
  layer?: string | null;
  requireLayer?: boolean;
  existing: ExistingFeature[];
}): string | null {
  const title = (input.title ?? "").trim();
  if (!title) return "⛔ A feature needs a non-empty title.";

  const category = (input.category ?? "").trim();
  if (!category) {
    const cats = existingCategories(input.existing);
    const reuse = cats.length
      ? ` Reuse an existing category where it fits: ${cats.join(", ")}.`
      : "";
    return (
      `⛔ Feature "${title}" has no category. Every roadmap feature needs one — it drives grouping ` +
      `and color on the board.${reuse} Pass it as \`category\` (e.g. AUTH, SEARCH, DATA, INTEL, ` +
      `BILLING, INFRA …); don't rely on a default.`
    );
  }

  if (input.requireLayer && !normalizeLayer(input.layer)) {
    return (
      `⛔ Feature "${title}" has no layer. This workspace has a frontend surface, so every roadmap ` +
      `feature must say which side of the stack it lands on. Pass it as \`layer\`: "frontend" | ` +
      `"backend" | "fullstack".`
    );
  }

  const dup = matchFeature(
    title,
    input.existing.map((f) => ({ id: f.id, title: f.title })),
  );
  if (dup.best) {
    const f = input.existing.find((e) => e.id === dup.best!.id);
    const status = f?.status ? ` (${f.status})` : "";
    return (
      `⛔ "${title}" already exists as the feature "${f?.title ?? dup.best.title}"${status}. Don't ` +
      `create a duplicate — mark progress on it with \`beacon_start_feature({ id })\`, add sub-tasks ` +
      `with \`beacon_add_subtasks\`, or finish it with \`beacon_describe_feature\`.`
    );
  }
  return null;
}

/** Dedup guard for a multi-feature plan (propose_plan / ExitPlanMode block): flags any proposed
 *  feature whose title confidently matches an EXISTING (non-draft) roadmap feature, so the agent
 *  reuses it instead of shadowing it. Returns a rejection message, or null when all are new. */
export function validateNoDuplicateFeatures(
  features: { title: string }[],
  existing: ExistingFeature[],
): string | null {
  const cands = existing.map((e) => ({ id: e.id, title: e.title }));
  const dups = features
    .map((f) => {
      const m = matchFeature(f.title ?? "", cands);
      return m.best ? { title: f.title, hit: existing.find((e) => e.id === m.best!.id)! } : null;
    })
    .filter((x): x is { title: string; hit: ExistingFeature } => x !== null);
  if (!dups.length) return null;
  return (
    "⛔ These proposed features already exist on the roadmap — reuse them instead of creating " +
    "duplicates:\n" +
    dups
      .map((d) => `  • "${d.title}" → existing "${d.hit.title}"${d.hit.status ? ` (${d.hit.status})` : ""}`)
      .join("\n") +
    "\n\nDrop the duplicate(s) from the plan; to add work to an existing feature, ship sub-tasks " +
    "or update it via beacon_describe_feature. Keep only genuinely new features in the proposal."
  );
}

/** Guard for the `front` param of beacon_start_feature: it must reference an EXISTING parent
 *  feature, NOT a domain label. Returns a rejection message, or null when front matches (or is
 *  empty — no front means the feature lands top-level, which is fine). */
export function validateFront(front: string, existingFronts: Candidate[]): string | null {
  const f = (front ?? "").trim();
  if (!f) return null;
  const m = matchFeature(f, existingFronts);
  if (m.best) return null;
  const hint = m.candidates.length
    ? ` Did you mean: ${m.candidates.map((c) => `"${c.title}"`).join(", ")}?`
    : "";
  return (
    `⛔ front "${f}" doesn't match an existing feature.${hint} \`front\` nests a feature UNDER an ` +
    `existing parent feature — it is NOT a domain tag. If "${f}" is a domain, pass it as \`category\` ` +
    `instead. If it's a real umbrella feature, create it first via beacon_propose_plan.`
  );
}
