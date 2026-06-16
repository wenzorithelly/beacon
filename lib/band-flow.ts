// Shared band-flow layout, used by every band-based board (roadmap, architecture, database). A
// board groups its nodes into variable-size BLOCKS (a domain, a cluster lane, a dependency block),
// computes each block's internal node offsets, then calls flowBlocksIntoBands to place the blocks:
// left→right, wrapping into bands at a width DERIVED FROM THE REVIEWER'S VIEWPORT — so a wide
// monitor lays the board out wider (fewer, shorter bands → less vertical scroll) and a narrow one
// stacks taller. PURE — no imports — so it runs identically on the server (arrange) and the client
// (the node-board arrange handlers). The Files board is force-directed (organic) and does NOT use
// this — it has no band concept.

export interface FlowBlock {
  id: string;
  w: number;
  h: number;
}

export interface BandFlowOptions {
  /** Horizontal gap between adjacent blocks in a band. */
  gapX: number;
  /** Vertical gap between bands. */
  gapY: number;
  /** Viewport aspect (width / height) from the client; the board is sized to match the screen.
   *  Omitted → a wide default (server-side one-shot / self-heal, which has no viewport). */
  viewportAspect?: number;
  /** Never wrap narrower than this, so a tiny board doesn't tower. */
  minBandW: number;
  /** Ragged blocks of uneven height pack a band looser than a perfect grid, so the REALIZED board
   *  comes out taller than the nominal target. Multiply the target aspect by this to compensate, so
   *  the board lands near the requested aspect in practice. Default 1 (a near-uniform grid). */
  aspectSlack?: number;
}

const DEFAULT_VIEWPORT_ASPECT = 1.8;

/** Keep the target aspect in a sane range — a sliver-thin or absurdly wide window shouldn't make
 *  the board unusable. */
export const clampViewportAspect = (a: number | undefined): number =>
  a && Number.isFinite(a) && a > 0 ? Math.min(3.2, Math.max(0.7, a)) : DEFAULT_VIEWPORT_ASPECT;

/** Band wrap width that targets the reviewer's viewport aspect. Wider screen → larger width → fewer
 *  bands → shorter board; narrow screen → taller. `bandW = max(minBandW, √(totalArea · aspect ·
 *  slack))` — the multiplier IS the target width:height, since height ≈ totalArea / width. */
export function viewportBandWidth(blocks: FlowBlock[], opts: BandFlowOptions): number {
  const targetK = clampViewportAspect(opts.viewportAspect) * (opts.aspectSlack ?? 1);
  const totalArea = blocks.reduce((s, b) => s + (b.w + opts.gapX) * (b.h + opts.gapY), 0);
  return Math.max(opts.minBandW, Math.round(Math.sqrt(totalArea * targetK)));
}

/** Flow blocks left→right, wrapping into bands at the viewport-derived width. Returns each block's
 *  TOP-LEFT origin; the caller adds its internal node offsets. Deterministic. */
export function flowBlocksIntoBands(
  blocks: FlowBlock[],
  opts: BandFlowOptions,
): Map<string, { x: number; y: number }> {
  const bandW = viewportBandWidth(blocks, opts);
  const origins = new Map<string, { x: number; y: number }>();
  let blockX = 0;
  let bandTop = 0;
  let bandMaxH = 0;
  for (const b of blocks) {
    if (blockX > 0 && blockX + b.w > bandW) {
      bandTop += bandMaxH + opts.gapY;
      blockX = 0;
      bandMaxH = 0;
    }
    origins.set(b.id, { x: blockX, y: bandTop });
    bandMaxH = Math.max(bandMaxH, b.h);
    blockX += b.w + opts.gapX;
  }
  return origins;
}
