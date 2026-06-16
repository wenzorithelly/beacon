import { db, type DB } from "@/lib/db-drizzle";

// Endpoint cards are uniform ~300×50px pills on /db. Their PLACEMENT now lives in
// lib/db-board-layout (each endpoint docks beneath its primary table); this module keeps the
// overlap check ingest uses to decide whether to self-heal, and the draft-origin helper.

const EP_CARD_WIDTH = 300;
const EP_CARD_HEIGHT = 50;

/**
 * Bounding-box overlap check ingest uses to decide whether to self-heal the board.
 * Anything overlapping means a stale pre-dock layout, or two ingest runs collided.
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
