import { count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dbTable, edge, endpoint, node, nodeFile, syncState } from "@/lib/drizzle/schema";

// Cheap per-board revision fingerprints for the live-refresh stream (app/api/stream/route.ts).
//
// The workspace has ONE version counter (SyncState.version) that every write bumps, so a version
// bump alone can't say WHAT changed — a code-graph re-ingest looks exactly like the agent adding a
// roadmap feature, and the client's only honest response was a full router.refresh(). These
// fingerprints let it tell them apart: an aggregate per board that changes when that board's rows
// change, so the client refetches just that board's JSON and reconciles by id.
//
// The contract is deliberately one-directional and therefore SOUND WITHOUT BEING COMPLETE:
//   fingerprint changed  ⟹  that board changed (a spurious refetch is harmless).
//   fingerprint unchanged ⟹  we say NOTHING; the caller falls back to the full refresh it does
//                            today. So an under-covered write (an Edge label edit, a BugFlag
//                            resolve, a note, a plan, a draft) degrades to current behaviour — it
//                            never goes silently stale.
// That is why this is a handful of counts and max(updatedAt)s rather than a change log: the
// fallback absorbs every gap, so the fingerprint only has to be cheap and monotone-ish, not exact.
//
// Values are OPAQUE strings — the client only ever compares them for equality (see changedBoards
// in lib/nav-decide.ts). Never parse them.
// Keys: "roadmap" (both Node views — ROADMAP + ARCHITECTURE share a table, a reader and a page),
// "db" (tables + endpoints), "code" (the intel daemon's import graph).
export type BoardRevisions = Record<string, string>;

/**
 * Read the current fingerprints. Six aggregates on a local SQLite file — but the stream only
 * calls this when the version counter actually moved, so the steady-state poll costs exactly
 * what it costs today.
 *
 * `code` is free: ingestCodeGraph/applyCodeGraphPatch already stamp SyncState.codeGraphSyncedAt
 * on every sync, and the stream has that row in hand for getVersion().
 */
export async function boardRevisions(): Promise<BoardRevisions> {
  try {
    const [nodes, edges, files, tables, endpoints, sync] = await Promise.all([
      db.select({ c: count(), m: sql<number>`coalesce(max(${node.updatedAt}), 0)` }).from(node),
      db.select({ c: count() }).from(edge),
      db.select({ c: count() }).from(nodeFile),
      db
        .select({ c: count(), m: sql<number>`coalesce(max(${dbTable.updatedAt}), 0)` })
        .from(dbTable),
      db
        .select({ c: count(), m: sql<number>`coalesce(max(${endpoint.updatedAt}), 0)` })
        .from(endpoint),
      db
        .select({ at: syncState.codeGraphSyncedAt })
        .from(syncState)
        .where(eq(syncState.id, "singleton")),
    ]);
    return {
      // Edge/NodeFile carry no updatedAt, so their row COUNT is the signal — enough for the
      // add/remove the agent actually does (touchFiles, dependency links).
      roadmap: `${nodes[0].c}:${nodes[0].m}:${edges[0].c}:${files[0].c}`,
      db: `${tables[0].c}:${tables[0].m}:${endpoints[0].c}:${endpoints[0].m}`,
      code: String(sync[0]?.at?.getTime() ?? 0),
    };
  } catch {
    // A fingerprint we can't read is not an error worth killing the stream over: an empty map
    // reads as "nothing attributable", which is the full-refresh fallback.
    return {};
  }
}
