// Gestalt "common region" boxes: one labeled bounding region per group of cards. An explicit
// container around related cards is the strongest preattentive grouping signal we can draw —
// it turns N scattered cards into a handful of readable chunks. Pure (no React) so the same
// math serves the roadmap lanes, the architecture domains, and the DB domain clusters, and is
// unit-tested. Extraction of map-client's former inline `lanes` memo.

export interface RegionInput {
  id: string;
  group: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
}

export interface RegionOptions {
  /** Padding around the members' bounding box. */
  pad?: number;
  /** Extra space above the box for the group label header. */
  header?: number;
}

/** One region per distinct `group`, wrapping its members' bounding box (padded, with label
 *  headroom). Sorted by key so output is deterministic regardless of input order. */
export function computeGroupRegions(items: RegionInput[], opts: RegionOptions = {}): Region[] {
  const pad = opts.pad ?? 20;
  const header = opts.header ?? 26;
  type Box = { minX: number; minY: number; maxX: number; maxY: number; count: number };
  const boxes = new Map<string, Box>();
  for (const it of items) {
    const b = boxes.get(it.group);
    if (b) {
      b.minX = Math.min(b.minX, it.x);
      b.minY = Math.min(b.minY, it.y);
      b.maxX = Math.max(b.maxX, it.x + it.w);
      b.maxY = Math.max(b.maxY, it.y + it.h);
      b.count++;
    } else {
      boxes.set(it.group, { minX: it.x, minY: it.y, maxX: it.x + it.w, maxY: it.y + it.h, count: 1 });
    }
  }
  return Array.from(boxes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, b]) => ({
      key,
      label: key,
      x: b.minX - pad,
      y: b.minY - pad - header,
      w: b.maxX - b.minX + pad * 2,
      h: b.maxY - b.minY + pad * 2 + header,
      count: b.count,
    }));
}
