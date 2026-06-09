// Reliable feature matching for the map. Combines accent-folding, content-token
// overlap (handles word reordering + filler words) and character-bigram similarity
// (handles stems/typos/substrings), with confidence tiers so we only auto-flag on a
// high-confidence unambiguous match and otherwise return candidates to disambiguate.

// Filler words stripped before matching. The Portuguese set is intentional and functional —
// it lets the matcher line up feature titles written in Portuguese (e.g. juriscan), NOT leftover
// UI cruft, so don't "clean it up" as part of an English-only pass.
const STOP = new Set([
  // English filler
  "a", "an", "the", "of", "for", "to", "and", "or", "in", "on", "with", "via", "by",
  "using", "use", "add", "adds", "support", "implement", "implementation", "feature",
  "new", "build", "create",
  // Portuguese filler
  "o", "os", "as", "um", "uma", "de", "da", "do", "das", "dos", "para", "por", "com",
  "e", "ou", "no", "na", "nos", "nas", "ao", "aos", "adicionar", "implementar",
  "suporte", "suportar", "nova", "novo", "funcionalidade", "usar", "usando", "criar",
]);

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function normExact(s: string): string {
  return fold(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function contentTokens(s: string): string[] {
  return normExact(s)
    .split(" ")
    .filter((t) => t && !STOP.has(t));
}

function diceSets(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

function charBigrams(s: string): Set<string> {
  const x = normExact(s).replace(/ /g, "");
  const set = new Set<string>();
  for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2));
  return set;
}

/** 0..1 similarity between two feature titles. */
export function similarity(a: string, b: string): number {
  const na = normExact(a);
  const nb = normExact(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const tokenDice = diceSets(new Set(contentTokens(a)), new Set(contentTokens(b)));
  const bigramDice = diceSets(charBigrams(a), charBigrams(b));
  return Math.min(1, 0.7 * tokenDice + 0.4 * bigramDice);
}

export interface Candidate {
  id: string;
  title: string;
}
export interface Scored extends Candidate {
  score: number;
}

export function rankMatches(query: string, candidates: Candidate[]): Scored[] {
  return candidates
    .map((c) => ({ ...c, score: Math.round(similarity(query, c.title) * 100) / 100 }))
    .sort((a, b) => b.score - a.score);
}

export interface MatchOutcome {
  /** A confident, unambiguous match — safe to act on automatically. */
  best: Scored | null;
  /** Plausible candidates to disambiguate (caller should pick one by id). */
  candidates: Scored[];
}

export function matchFeature(
  query: string,
  candidates: Candidate[],
  opts: { confident?: number; consider?: number; margin?: number } = {},
): MatchOutcome {
  const confident = opts.confident ?? 0.72;
  const consider = opts.consider ?? 0.5;
  const margin = opts.margin ?? 0.1;

  const ranked = rankMatches(query, candidates);
  const top = ranked[0];
  if (!top || top.score < consider) return { best: null, candidates: [] };

  const runnerUp = ranked[1]?.score ?? 0;
  const unambiguous = ranked.length === 1 || top.score - runnerUp >= margin;

  if (top.score >= confident && unambiguous) return { best: top, candidates: [] };
  return { best: null, candidates: ranked.filter((r) => r.score >= consider).slice(0, 4) };
}
