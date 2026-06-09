// Deterministic layout for the ARCHITECTURE canvas. The old layout placed every component in
// one row keyed by domain index (x=lane*320, y=0 for single-component domains) which read as a
// sparse horizontal sprawl. This groups components by their domain, stacks each domain's
// components into a column, and flows the domain-columns into a wrapped grid (a few domains per
// band, then wrap down) so related components sit together and the board stays compact.

export interface ArchLayoutOptions {
  /** Horizontal spacing between group columns. */
  colW?: number;
  /** Vertical spacing between items stacked in a group (one "row slot"). */
  rowH?: number;
  /** How many group columns per horizontal band before wrapping to a new band. */
  perBand?: number;
  /** Vertical gap between bands. */
  bandGap?: number;
}

export interface GroupLayoutOptions extends ArchLayoutOptions {
  /**
   * Explicit lane ordering. Groups listed here come first in this order (only if present
   * among the items); any remaining groups follow, sorted alphabetically. When omitted,
   * groups keep first-seen order (the original architecture behaviour).
   */
  groupOrder?: readonly string[];
  /**
   * How many vertical row-slots an item consumes (default 1). Lets a feature reserve
   * room beneath itself for its stacked sub-tasks so siblings below don't overlap.
   */
  weightFn?: (it: unknown) => number;
}

// Generic deterministic grid layout: bucket items by `keyFn`, stack each bucket into a
// column, and flow the columns into wrapped bands so related items sit together and the
// board stays compact. Returns a Map keyed by the item object so callers can read back
// positions without re-deriving identity. This is the single layout primitive powering both
// the architecture domain layout and the roadmap group-by lanes.
export function layoutByGroup<T>(
  items: T[],
  keyFn: (it: T) => string,
  opts: GroupLayoutOptions = {},
): Map<T, { x: number; y: number }> {
  const colW = opts.colW ?? 320;
  const rowH = opts.rowH ?? 150;
  const perBand = opts.perBand ?? 4;
  const bandGap = opts.bandGap ?? 90;
  const weightFn = opts.weightFn ?? (() => 1);

  // Group by key, preserving first-seen order within each bucket.
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const key = keyFn(it);
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  // Order the lanes: explicit groupOrder first (present groups only), then the rest
  // alphabetically. No groupOrder → first-seen order (preserves architecture behaviour).
  const present = Array.from(groups.keys());
  let ordered: string[];
  if (opts.groupOrder) {
    const listed = opts.groupOrder.filter((g) => groups.has(g));
    const rest = present.filter((g) => !opts.groupOrder!.includes(g)).sort();
    ordered = [...listed, ...rest];
  } else {
    ordered = present;
  }

  const pos = new Map<T, { x: number; y: number }>();
  let bandTopY = 0;
  for (let b = 0; b < ordered.length; b += perBand) {
    const band = ordered.slice(b, b + perBand);
    let bandRows = 0;
    band.forEach((key, colInBand) => {
      const comps = groups.get(key)!;
      let cum = 0; // accumulated row-slots consumed so far in this column
      comps.forEach((it) => {
        pos.set(it, { x: colInBand * colW, y: bandTopY + cum * rowH });
        cum += weightFn(it);
      });
      bandRows = Math.max(bandRows, cum);
    });
    bandTopY += bandRows * rowH + bandGap;
  }
  return pos;
}

// Position each item, grouped by `domain` (first-seen order preserved). Thin wrapper over
// layoutByGroup. Null/empty domains collapse into one group.
export function layoutArchitectureByDomain<T extends { domain: string | null }>(
  items: T[],
  opts: ArchLayoutOptions = {},
): Map<T, { x: number; y: number }> {
  return layoutByGroup(items, (it) => (it.domain ?? "").trim() || "—", opts);
}
