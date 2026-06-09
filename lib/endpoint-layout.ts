import { count, eq } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { endpoint } from "@/lib/drizzle/schema";

// Endpoints are uniform 240px-wide pill cards on /db, kept to the left of the table
// gutter (negative x). The previous layout stacked every endpoint in one column at
// y = i * 110, so a real backend like Beacon ended up with a 4000px-tall stack the
// user had to scroll past. We now wrap into a multi-column grid that grows leftward,
// so the canvas reads as a compact block instead of a fence.

const EP_ROW_HEIGHT = 60;
const EP_COL_WIDTH = 280;
const EP_BASE_X = -300; // closest column to the tables on the right
const EP_ROWS_PER_COL = 12;
const EP_CARD_WIDTH = 240;
const EP_CARD_HEIGHT = 50;

/**
 * Bounding-box overlap check ingest uses to decide whether to self-heal the column.
 * Endpoint cards are uniform 240px wide × ~40px tall pills — anything overlapping
 * means an old single-column ingest left a stack behind, or two ingest runs collided.
 */
export function endpointsOverlap(
  eps: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  for (let i = 0; i < eps.length; i++) {
    for (let j = i + 1; j < eps.length; j++) {
      const a = eps[i];
      const b = eps[j];
      if (
        a.x < b.x + EP_CARD_WIDTH &&
        a.x + EP_CARD_WIDTH > b.x &&
        a.y < b.y + EP_CARD_HEIGHT &&
        a.y + EP_CARD_HEIGHT > b.y
      ) {
        return true;
      }
    }
  }
  return false;
}

export function gridPositionForEndpoint(index: number): { x: number; y: number } {
  const col = Math.floor(index / EP_ROWS_PER_COL);
  const row = index % EP_ROWS_PER_COL;
  return { x: EP_BASE_X - col * EP_COL_WIDTH, y: row * EP_ROW_HEIGHT };
}

/**
 * One-off repair: re-pack every endpoint into a clean grid. Stable order — sorts by
 * current (y, x) so the user's visual ordering carries over across the change, then by
 * id as a tiebreaker.
 */
export async function relayoutEndpoints(prisma: DB = db): Promise<number> {
  const eps = await prisma.query.endpoint.findMany({
    orderBy: (t, { asc, desc }) => [asc(t.y), desc(t.x), asc(t.id)],
  });
  if (eps.length === 0) return 0;
  let moved = 0;
  for (let i = 0; i < eps.length; i++) {
    const { x, y } = gridPositionForEndpoint(i);
    const e = eps[i];
    if (e.x === x && e.y === y) continue;
    await prisma.update(endpoint).set({ x, y }).where(eq(endpoint.id, e.id));
    moved++;
  }
  return moved;
}

/**
 * Where to drop the next NEW endpoint so it lands in the first unfilled grid slot.
 * Used by ingest to keep code-derived endpoints from re-stacking the old single column.
 */
export async function nextEndpointSlot(prisma: DB = db): Promise<{ x: number; y: number }> {
  const [{ n }] = await prisma.select({ n: count() }).from(endpoint);
  return gridPositionForEndpoint(n);
}

/**
 * Where to drop a freshly-proposed draft on the /db canvas so it doesn't land on top of
 * the existing tables/endpoints. Returns the largest y in use plus a margin, or 0 if the
 * canvas is empty.
 */
const DRAFT_MARGIN = 280;
export async function computeDraftOriginY(prisma: DB = db): Promise<number> {
  const [topTbl, topEp] = await Promise.all([
    prisma.query.dbTable.findFirst({ orderBy: (t, { desc }) => desc(t.y) }),
    prisma.query.endpoint.findFirst({ orderBy: (t, { desc }) => desc(t.y) }),
  ]);
  const maxY = Math.max(topTbl?.y ?? 0, topEp?.y ?? 0);
  return maxY > 0 ? maxY + DRAFT_MARGIN : 0;
}
