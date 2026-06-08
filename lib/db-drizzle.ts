import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "@/lib/drizzle/schema";
import * as relations from "@/lib/drizzle/relations";
import { dbUrlFor, ensureWorkspaceDb, getActiveId, getPinnedWorkspaceId } from "@/lib/workspaces";

// Beacon's data client: Drizzle over Bun's native SQLite. Replaces the Prisma + libSQL stack —
// the DB is local-only and the server runs under Bun, so `bun:sqlite` is built in (no native
// addon, no driver adapter, no Postgres-portability constraint). Mirrors the per-workspace
// resolution the old lib/db.ts had: one cached client per workspace db file, resolved from the
// BEACON_REPO env pin → request ALS pin → active workspace → env default.

export { runWithWorkspace } from "@/lib/workspaces";

const fullSchema = { ...schema, ...relations };
export type DB = BunSQLiteDatabase<typeof fullSchema>;

const DEFAULT_URL = process.env.DATABASE_URL ?? "file:./dev.db";

// bun:sqlite wants a filesystem path; the workspace layer speaks `file:<path>` URLs.
function pathFromUrl(dbUrl: string): string {
  return dbUrl.startsWith("file:") ? dbUrl.slice("file:".length) : dbUrl;
}

function createClient(dbUrl: string): DB {
  const sqlite = new Database(pathFromUrl(dbUrl), { create: true });
  // WAL + a busy timeout so the daemon, the intel watcher, and request handlers can hit the same
  // file without tripping over each other; foreign_keys ON to honor the cascade deletes.
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  return drizzle(sqlite, { schema: fullSchema });
}

const globalForDb = globalThis as unknown as {
  dzByUrl?: Map<string, DB>;
  dzHealed?: Set<string>;
  dzDefault?: DB;
};

// The env-configured client (DATABASE_URL) — used by the CLI, watcher, seeds, tests, and as the
// fallback when no workspace is active.
export const defaultDb = globalForDb.dzDefault ?? createClient(DEFAULT_URL);
if (process.env.NODE_ENV !== "production") globalForDb.dzDefault = defaultDb;

const clients = (globalForDb.dzByUrl ??= new Map<string, DB>());

export function getDb(dbUrl: string): DB {
  let c = clients.get(dbUrl);
  if (!c) {
    c = createClient(dbUrl);
    clients.set(dbUrl, c);
  }
  return c;
}

export function invalidateDb(dbUrl: string): void {
  clients.delete(dbUrl);
}

// Provision/heal a workspace's db at most once per process (file present + schema current).
const healed = (globalForDb.dzHealed ??= new Set<string>());

function activeDb(): DB {
  if (process.env.BEACON_REPO) return defaultDb;
  const id = getPinnedWorkspaceId() ?? getActiveId();
  if (!id) return defaultDb;
  const dbUrl = dbUrlFor(id);
  if (!healed.has(dbUrl)) {
    if (ensureWorkspaceDb(id).ok) healed.add(dbUrl);
  }
  return getDb(dbUrl);
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
