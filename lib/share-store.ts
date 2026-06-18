import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { sharedBoard } from "@/lib/feedback/schema";
import { shareSnapshotSchema, snapshotSummary, type ShareSnapshot } from "@/lib/share-snapshot";

// Deploy-side persistence for shared boards (the Neon prod DB). Kept free of a top-level
// `@/lib/feedback/db` import so the pure helpers (parse/expiry/interpret) load under `bun test`;
// `feedbackDb()` is lazy-imported only when an actual read/write runs. The DB handle is also
// injectable (`opts.dbInstance`) so the row write can be unit-tested with a stub.

// Cap the cross-origin payload so an open ingest can't be used to stuff the store with huge blobs.
// With Files excluded, Roadmap+Architecture+DB+Plan stays well under this.
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
// Links auto-expire after 7 days (the viewer 404s past it; a cron/manual sweep can hard-delete).
export const SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ParseResult =
  | { ok: true; snapshot: ShareSnapshot }
  | { ok: false; status: 400 | 413; error: string };

/** Validate a raw cross-origin body: byte cap → JSON → snapshot schema (incl. version gate). */
export function parseShareSnapshot(rawText: string): ParseResult {
  if (Buffer.byteLength(rawText, "utf8") > MAX_SNAPSHOT_BYTES)
    return { ok: false, status: 413, error: "snapshot too large" };
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return { ok: false, status: 400, error: "invalid json" };
  }
  const parsed = shareSnapshotSchema.safeParse(json);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid snapshot" };
  return { ok: true, snapshot: parsed.data as ShareSnapshot };
}

export function expiresAtFrom(now: number): Date {
  return new Date(now + SHARE_TTL_MS);
}

/** Bearer-token check gating the PINNED (fixed-token, never-expiring) share path on the open public
 *  ingest. An unset/empty configured token must NEVER authorize (missing env = locked, not open).
 *  Constant-time compare. Mirrors the telemetry-stats gate. */
export function isAuthorizedShareRequest(
  authorizationHeader: string | null | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!configuredToken) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(configuredToken);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

// A row's stored expiresAt can come back as a Date (neon timestamp) — normalize defensively.
function expiresMs(expiresAt: Date | string | number | null): number | null {
  if (expiresAt == null) return null;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Pure decision over a fetched row: is it expired, and is its payload a valid snapshot?
 *  Returns null when the payload can't be parsed (treat as not-found). */
export function interpretSharedRow(
  row: { payload: string; expiresAt: Date | string | number | null },
  now: number,
): { snapshot: ShareSnapshot; expired: boolean } | null {
  const parsed = parseShareSnapshot(row.payload);
  if (!parsed.ok) return null;
  const exp = expiresMs(row.expiresAt);
  return { snapshot: parsed.snapshot, expired: exp != null && exp < now };
}

// Minimal shape of the Drizzle handle the writes/reads need — lets a test inject a stub.
// The write path is an UPSERT (insert→values→onConflictDoUpdate) so a pinned board refreshes the
// same token row in place instead of colliding on the PK.
type ShareDb = {
  insert: (table: typeof sharedBoard) => {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (cfg: { target: unknown; set: Record<string, unknown> }) => Promise<unknown>;
    };
  };
  select: () => {
    from: (table: typeof sharedBoard) => {
      where: (cond: unknown) => { limit: (n: number) => Promise<Array<Record<string, unknown>>> };
    };
  };
};

async function resolveDb(): Promise<ShareDb> {
  const { feedbackDb } = await import("@/lib/feedback/db");
  return feedbackDb() as unknown as ShareDb;
}

/** Write the snapshot row, upserting on the token so a refresh overwrites in place. Returns the
 *  token + its expiry. `permanent` stores a null expiry (never 404s — the pinned prod board);
 *  otherwise the row expires after SHARE_TTL_MS. A custom `token` gives a stable, bookmarkable URL. */
export async function insertSharedBoard(
  snapshot: ShareSnapshot,
  opts: { now?: number; token?: string; permanent?: boolean; dbInstance?: ShareDb } = {},
): Promise<{ token: string; expiresAt: Date | null }> {
  const database = opts.dbInstance ?? (await resolveDb());
  const { createId } = await import("@paralleldrive/cuid2");
  const token = opts.token ?? createId();
  const expiresAt = opts.permanent ? null : expiresAtFrom(opts.now ?? Date.now());
  const mutable = {
    payload: JSON.stringify(snapshot),
    selectedTabs: snapshotSummary(snapshot),
    workspaceLabel: snapshot.workspaceLabel,
    version: snapshot.version,
    expiresAt,
  };
  await database
    .insert(sharedBoard)
    .values({ token, ...mutable })
    .onConflictDoUpdate({ target: sharedBoard.token, set: mutable });
  return { token, expiresAt };
}

/** Fetch + interpret a shared board by token. null = not found / unparseable. */
export async function readSharedBoard(
  token: string,
  opts: { now?: number; dbInstance?: ShareDb } = {},
): Promise<{ snapshot: ShareSnapshot; expired: boolean } | null> {
  const database = opts.dbInstance ?? (await resolveDb());
  const rows = await database
    .select()
    .from(sharedBoard)
    .where(eq(sharedBoard.token, token))
    .limit(1);
  const row = rows[0] as { payload: string; expiresAt: Date | string | number | null } | undefined;
  if (!row) return null;
  return interpretSharedRow(row, opts.now ?? Date.now());
}
