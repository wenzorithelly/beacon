import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "@/lib/drizzle/schema";
import * as relations from "@/lib/drizzle/relations";
import { dbUrlFor, getActiveId, getPinnedWorkspaceId } from "@/lib/workspaces";

// Beacon's data client: Drizzle over libSQL. libSQL is the one SQLite driver that loads under BOTH
// runtimes Beacon uses — Node (the Next server) AND Bun (`bun test`, the CLI, the intel watcher) —
// because it's pure JS with no native addon. (Bun's `bun:sqlite` is unavailable inside the Next
// server runtime; better-sqlite3's native addon won't load under Bun. libSQL works in both.)
// Provisioning (schema create + pending migrations + the legacy-timestamp heal) runs in-process via
// the SAME libSQL driver — see lib/drizzle/provision + lib/workspaces.ensureWorkspaceDb.
//
// Per-workspace resolution mirrors the old lib/db.ts: one cached client per workspace db file,
// resolved from the BEACON_REPO env pin → request ALS pin → active workspace → env default.

export { runWithWorkspace } from "@/lib/workspaces";

const fullSchema = { ...schema, ...relations };
export type DB = LibSQLDatabase<typeof fullSchema>;

// libSQL only speaks file: / libsql: / ws(s): / http(s): (Turso) / :memory: URLs. On a hosted
// deploy a Neon (or Vercel-Postgres) integration injects a Postgres DATABASE_URL
// (postgresql://…&channel_binding=require) that libSQL rejects at connect — and the per-workspace
// SQLite isn't used on the public deploy anyway (tool routes redirect to the landing). So only
// honor DATABASE_URL when it's a libSQL-compatible scheme; otherwise fall back to a local file.
function libsqlDefaultUrl(): string {
  const u = process.env.DATABASE_URL;
  if (u && /^(file:|libsql:|wss?:|https?:|:memory:)/i.test(u)) return u;
  return "file:./dev.db";
}
const DEFAULT_URL = libsqlDefaultUrl();

function createDbClient(dbUrl: string): DB {
  const client = createClient({ url: dbUrl });
  // SQLite enforces FK cascades only when foreign_keys is ON (per connection). libSQL runs requests
  // serially on the connection, so this lands before any app query.
  void client.execute("PRAGMA foreign_keys = ON;");
  // Several processes share one workspace file (dev server, intel watcher, CLI, tests). With no
  // busy timeout a writer that catches another mid-write fails INSTANTLY with "database is
  // locked" (the arrange's burst of row updates hit this on /map load). 5s of retrying makes
  // concurrent writers queue instead of crash.
  void client.execute("PRAGMA busy_timeout = 5000;");
  return drizzle(client, { schema: fullSchema });
}

const globalForDb = globalThis as unknown as {
  dzByUrl?: Map<string, DB>;
  dzDefault?: DB;
};

// The env-configured client (DATABASE_URL) — used by the CLI, watcher, seeds, tests, and as the
// fallback when no workspace is active.
export const defaultDb = globalForDb.dzDefault ?? createDbClient(DEFAULT_URL);
if (process.env.NODE_ENV !== "production") globalForDb.dzDefault = defaultDb;

const clients = (globalForDb.dzByUrl ??= new Map<string, DB>());

export function getDb(dbUrl: string): DB {
  let c = clients.get(dbUrl);
  if (!c) {
    c = createDbClient(dbUrl);
    clients.set(dbUrl, c);
  }
  return c;
}

export function invalidateDb(dbUrl: string): void {
  clients.delete(dbUrl);
}

/** Evict AND close a workspace's cached client — for when the db file itself is being
 *  deleted, so no open libSQL handle outlives the unlinked file. (invalidateDb only
 *  drops the cache reference; its callers want a reconnect, not a teardown.) */
export function closeDb(dbUrl: string): void {
  const c = clients.get(dbUrl);
  clients.delete(dbUrl);
  try {
    // Drizzle attaches the raw libSQL client as $client at runtime; the DB type doesn't declare it.
    (c as unknown as { $client?: { close?: () => void } } | undefined)?.$client?.close?.();
  } catch {
    // already closed
  }
}

// The fallback db (DEFAULT_URL) is the one db NO boundary used to provision or migrate — it only
// gets hit when no workspace resolves (zero registered, or the last one was just deleted), at
// which point a schema-stale dev.db 500s every query ("no such column: …"). Heal it the same way
// per-workspace dbs are healed, memoized per url per process. Local files only: a remote
// (libsql:/Turso) DATABASE_URL must never be migrated from here. Never throws.
const defaultProvisioned = new Map<string, Promise<void>>();
export function ensureDefaultDb(url: string = DEFAULT_URL): Promise<void> {
  if (!/^file:/i.test(url)) return Promise.resolve();
  let p = defaultProvisioned.get(url);
  if (!p) {
    p = import("@/lib/drizzle/provision")
      .then(({ provisionDb }) => provisionDb(url))
      .then(() => {})
      .catch((e) => {
        defaultProvisioned.delete(url); // let a later boundary retry
        console.error("[beacon] fallback db provision failed:", e instanceof Error ? e.message : e);
      });
    defaultProvisioned.set(url, p);
  }
  return p;
}

// Resolve the workspace this access targets and return its cached client. Provisioning/migration is
// NOT done here: the libSQL migrator is async and this getter is synchronous (it returns a bound
// Drizzle method to call). Callers reach a workspace through an async boundary that has already
// awaited ensureWorkspaceDb — pinned()/the activation routes/MCP startup — so the file + schema are
// ready by the time any query runs. (Provisioning a missing db inside a sync getter used to mean a
// blocking out-of-process `bun` spawn on first access; moving it to the boundary removes that.)
function activeDb(): DB {
  if (process.env.BEACON_REPO) return defaultDb;
  const id = getPinnedWorkspaceId() ?? getActiveId();
  if (!id) return defaultDb;
  return getDb(dbUrlFor(id));
}

// Same ergonomics as before: the whole lib layer imports `db` and the active workspace is resolved
// per access. Drizzle's methods (select/insert/update/delete/query/transaction) are forwarded.
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const active = activeDb();
    const value = (active as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(active) : value;
  },
});
