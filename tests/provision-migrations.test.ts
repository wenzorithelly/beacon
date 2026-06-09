import { afterAll, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionDb } from "@/lib/drizzle/provision";

// A throwaway migrations folder in drizzle's on-disk format (meta/_journal.json + <tag>.sql),
// so we can exercise a real multi-migration upgrade without touching the repo's own drizzle/ dir.
const ROOT = mkdtempSync(join(tmpdir(), "beacon-prov-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let dirSeq = 0;
function migrationsDir(entries: { tag: string; when: number; sql: string }[]): string {
  const dir = join(ROOT, `mig-${dirSeq++}`);
  mkdirSync(join(dir, "meta"), { recursive: true });
  writeFileSync(
    join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: entries.map((e, idx) => ({
        idx,
        version: "6",
        when: e.when,
        tag: e.tag,
        breakpoints: true,
      })),
    }),
  );
  for (const e of entries) writeFileSync(join(dir, `${e.tag}.sql`), e.sql);
  return dir;
}

let dbSeq = 0;
function freshDbUrl(): string {
  return `file:${join(ROOT, `db-${dbSeq++}.sqlite`)}`;
}

const M0 = { tag: "0000_init", when: 1_000_000, sql: `CREATE TABLE "Widget" ("id" text PRIMARY KEY NOT NULL);` };
const M1 = { tag: "0001_add", when: 2_000_000, sql: `ALTER TABLE "Widget" ADD "extra" text;` };

async function columns(dbUrl: string, table: string): Promise<string[]> {
  const c = createClient({ url: dbUrl });
  try {
    const r = await c.execute(`PRAGMA table_info("${table}")`);
    return r.rows.map((row) => String(row.name));
  } finally {
    c.close();
  }
}

describe("provisionDb — migrations apply to EXISTING dbs (the core bug)", () => {
  it("applies a newly-added migration to a db that already has the baseline", async () => {
    const url = freshDbUrl();

    // First provision: only the baseline migration exists.
    const first = await provisionDb(url, migrationsDir([M0]));
    expect((await columns(url, "Widget")).sort()).toEqual(["id"]);
    // Fresh-file provisioning DID change schema, so migrated is true on this call too.
    expect(first.migrated).toBe(true);

    // A new migration is authored later. Re-provisioning the SAME existing db must apply it —
    // the old `if (!tableExists("Node")) migrate()` guard skipped this forever.
    const second = await provisionDb(url, migrationsDir([M0, M1]));
    expect((await columns(url, "Widget")).sort()).toEqual(["extra", "id"]);
    expect(second.migrated).toBe(true);

    // Idempotent: a third call with the same set applies nothing new.
    const third = await provisionDb(url, migrationsDir([M0, M1]));
    expect(third.migrated).toBe(false);
    expect((await columns(url, "Widget")).sort()).toEqual(["extra", "id"]);
  });
});

describe("provisionDb — legacy Prisma db is baselined, never clashes", () => {
  it("marks the baseline applied for a pre-Drizzle db (tables present, no journal)", async () => {
    const url = freshDbUrl();

    // Simulate a legacy Prisma db: a "Node" table exists with data, but there is NO
    // __drizzle_migrations journal. Running the migrator naively would re-run CREATE TABLE "Node"
    // and throw "table Node already exists".
    const seed = createClient({ url });
    await seed.execute('CREATE TABLE "Node" ("id" text PRIMARY KEY NOT NULL)');
    await seed.execute(`INSERT INTO "Node" ("id") VALUES ('keep-me')`);
    seed.close();

    // Provisioning against a migrations dir whose 0000 also creates "Node" must NOT clash.
    const legacyMig = migrationsDir([{ tag: "0000_init", when: 1_000_000, sql: `CREATE TABLE "Node" ("id" text PRIMARY KEY NOT NULL);` }]);
    const r = await provisionDb(url, legacyMig);
    expect(r.migrated).toBe(true); // baselined

    // The pre-existing row survived (no destructive re-create) and the baseline row is recorded.
    const check = createClient({ url });
    try {
      const rows = await check.execute(`SELECT id FROM "Node"`);
      expect(rows.rows.map((x) => String(x.id))).toEqual(["keep-me"]);
      const j = await check.execute('SELECT count(*) AS n FROM "__drizzle_migrations"');
      expect(Number(j.rows[0]?.n)).toBe(1);
    } finally {
      check.close();
    }

    // Second provisioning is a clean no-op (journal now present → no re-baseline, nothing new).
    const again = await provisionDb(url, legacyMig);
    expect(again.migrated).toBe(false);
  });
});
