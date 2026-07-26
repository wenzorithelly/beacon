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
  // A card with a title and nothing else is unreadable a week later — the reader can't tell what
  // the work IS without re-deriving it. There is ONE agent-facing name for this: `description`.
  description?: string | null;
  // `plain` is the DB COLUMN the description normalizes onto (lib/feature-design's transform), and
  // it is NOT a second agent-facing name — no tool schema mentions it. It's declared here only
  // because /api/plan validates the POST-TRANSFORM features (route.ts `featureInput = parsed.features`),
  // by which point `description` is already `plain`. Reading both is what lets one rule serve the
  // pre-parse MCP path and the post-parse route path.
  plain?: string | null;
}

// The feature's category, accepting the `cluster` / `category` / `domain` aliases.
export function featureCategory(f: FeatureLike): string | null {
  return f.cluster ?? f.category ?? f.domain ?? null;
}

/** The card's body, whether it's still the agent's `description` or the normalized `plain` column. */
export function featureDescription(f: FeatureLike): string {
  return (f.description ?? f.plain ?? "").trim();
}

// Minimum length for a description to count as one. A gate that only checks non-empty is theater:
// it is satisfied by "TBD", which is exactly the card this rule exists to prevent. 80 characters is
// about one real sentence — enough to say what the work is and why, short enough that a genuinely
// small card isn't blocked. Markdown is welcome and unbounded above.
export const MIN_DESCRIPTION_CHARS = 80;

export function describedEnough(f: FeatureLike): boolean {
  return featureDescription(f).length >= MIN_DESCRIPTION_CHARS;
}

// Does an EXISTING card collide with a CANDIDATE (a proposed feature / an `add`)? It collides
// when it matches every dimension the candidate SPECIFIED — an omitted category or layer is a
// wildcard (so a bare `add` still reuses an existing card), but a SPECIFIED category or layer
// that DIFFERS makes the candidate a distinct card. Net effect: a same-named card is allowed only
// when it deliberately differs in category or layer (frontend / backend / fullstack). Legacy
// uncategorized cards still collide with each other (empty category matches empty).
type BucketKeyed = {
  cluster?: string | null;
  category?: string | null;
  domain?: string | null;
  layer?: string | null;
};
export function collidesWith(existing: BucketKeyed, candidate: BucketKeyed): boolean {
  const cat = (x: BucketKeyed) => (x.cluster ?? x.category ?? x.domain ?? "").trim().toLowerCase();
  const candCat = cat(candidate);
  if (candCat && candCat !== cat(existing)) return false;
  const candLayer = normalizeLayer(candidate.layer ?? null);
  if (candLayer && candLayer !== normalizeLayer(existing.layer ?? null)) return false;
  return true;
}

// Returns an agent-facing rejection message when any feature is missing its category/priority/
// description (and, when the workspace has a frontend, its layer), or null when every feature is
// complete.
export function validateProposedFeatures(
  features: FeatureLike[],
  opts?: { requireLayer?: boolean },
): string | null {
  const requireLayer = opts?.requireLayer ?? false;
  let anyThin = false;
  const gaps = features
    .map((f) => {
      const missing: string[] = [];
      const category = featureCategory(f);
      if (!category || !category.trim()) missing.push("category");
      if (f.priority == null) missing.push("priority");
      if (requireLayer && !normalizeLayer(f.layer)) missing.push("layer");
      // A too-short description reads differently from a missing one — name which it is, so the
      // agent knows to EXPAND rather than to add a field it already sent.
      if (!describedEnough(f)) {
        const had = featureDescription(f).length;
        missing.push(had ? `a fuller description (has ${had} chars, needs ${MIN_DESCRIPTION_CHARS})` : "description");
        anyThin = true;
      }
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
  const descriptionRule = anyThin
    ? " Every feature also needs a real `description` — a title alone is unreadable a week later, " +
      "when nobody can tell what the work IS without re-deriving it. Markdown is welcome: say what " +
      "the card does, why it matters, and name the files it touches in `backticks`."
    : "";
  return (
    "⛔ Every roadmap feature needs a category AND a priority AND a description — they drive " +
    "grouping, ordering and comprehension on the board, and the user shouldn't have to add them by " +
    "hand." +
    layerRule +
    descriptionRule +
    " Missing:\n" +
    gaps.join("\n") +
    "\n\nRe-present with each feature carrying its category as `category` (or `cluster` — both " +
    "work; e.g. AUTH, SEARCH, DATA, INTEL, BILLING …), `priority` (0 = P0 critical, 1 = P1 " +
    "high, 2 = P2 medium, 3 = P3 low), and `description`." +
    (requireLayer ? " Set `layer` on EVERY feature too." : "") +
    " Don't rely on defaults."
  );
}

export interface ExistingFeature {
  id: string;
  title: string;
  cluster?: string | null;
  /** Which side of the stack — part of the dedup bucket, so a same-named card on a different
   *  layer (FE/BE/FS) isn't treated as a duplicate. */
  layer?: string | null;
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
 *  mirroring the propose_plan gate: a feature must carry a category and a description, and must not
 *  duplicate an existing one. Returns an agent-facing rejection message, or null when it's safe to
 *  create. Pure (no db) so the route + the MCP process share one rule. */
export function validateFeatureCreation(input: {
  title: string;
  category?: string | null;
  layer?: string | null;
  /** beacon_feature calls it `detail`; the plan flow calls it `description`. Either satisfies this. */
  detail?: string | null;
  description?: string | null;
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

  // Only same-(category, layer) cards collide: a same-named card in a different category or layer
  // is a distinct card, so it's never blocked as a duplicate.
  const bucket = input.existing.filter((e) =>
    collidesWith(e, { category, layer: input.layer }),
  );
  const dup = matchFeature(
    title,
    bucket.map((f) => ({ id: f.id, title: f.title })),
  );
  if (dup.best) {
    const f = bucket.find((e) => e.id === dup.best!.id);
    const status = f?.status ? ` (${f.status})` : "";
    return (
      `⛔ "${title}" already exists as the feature "${f?.title ?? dup.best.title}"${status}. Don't ` +
      `create a duplicate — start it with \`beacon_feature({ action: "start", id })\`, add sub-tasks ` +
      `with \`beacon_feature({ action: "subtasks" })\`, or finish it with \`beacon_feature({ action: "done" })\`.`
    );
  }

  // Description is checked LAST, deliberately: it's the only gap that costs the agent real work to
  // close, so every cheaper rejection (no category, wrong layer, already exists) must fire first.
  // Telling someone to write 80 characters about a card that already exists wastes the write.
  if (!describedEnough({ title, description: input.description })) {
    const had = featureDescription({ title, description: input.description }).length;
    return (
      `⛔ Feature "${title}" ${had ? `has only a ${had}-char description` : "has no description"} — ` +
      `every roadmap card needs at least ${MIN_DESCRIPTION_CHARS} characters saying what the work IS ` +
      `and why, or it's unreadable a week later. Pass it as \`description\`; markdown is welcome, and ` +
      `naming the files it touches in \`backticks\` makes them clickable on the board.`
    );
  }
  return null;
}

/** Dedup guard for a multi-feature plan (propose_plan / ExitPlanMode block): flags any proposed
 *  feature whose title confidently matches an EXISTING (non-draft) roadmap feature, so the agent
 *  reuses it instead of shadowing it. Returns a rejection message, or null when all are new. */
export function validateNoDuplicateFeatures(
  features: FeatureLike[],
  existing: ExistingFeature[],
): string | null {
  const dups = features
    .map((f) => {
      // Only same-(category, layer) cards can collide — a same-named card in a different category
      // or on a different layer (FE/BE/FS) is a distinct card, never flagged as a duplicate.
      const bucket = existing.filter((e) => collidesWith(e, f));
      const m = matchFeature(
        f.title ?? "",
        bucket.map((e) => ({ id: e.id, title: e.title })),
      );
      return m.best ? { title: f.title, hit: bucket.find((e) => e.id === m.best!.id)! } : null;
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
    "or update it via `beacon_feature({ action: \"done\" })`. Keep only genuinely new features in the proposal."
  );
}

/** Guard for the `front` param of beacon_feature (add/start): it must reference an EXISTING parent
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
