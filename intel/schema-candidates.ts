// Which repo files can change the DB-board truth (tables / endpoints)? The inline watcher
// re-reads ONLY these when they change and feeds them to the deterministic extractors —
// ORM models (Drizzle/Prisma/SQLAlchemy) and Next App Router route files. Paths are
// base-relative POSIX, exactly as the incremental code graph reports them.

const ROUTE_FILE = /(^|\/)app\/.*\/route\.(ts|tsx|js|jsx|mjs)$/;
const MODEL_FILE = /\.(ts|py)$/;
const MODEL_HINT = /(schema|model)/i;
// Test/spec files routinely embed ORM declarations as fixtures (e.g.
// tests/model-extract.test.ts has sqliteTable("Node", …)); feeding them to the
// deterministic extractor duplicates and overwrites the repo's real tables on the
// /db board. Exclude JS/TS test+spec files, pytest files, and test directories.
const TEST_FILE =
  /(\.(test|spec)\.[jt]sx?$)|(^|\/)(tests?|__tests__|__mocks__)\/|(^|\/)test_[^/]+\.py$|_test\.py$/;

export function isSchemaCandidate(rel: string): boolean {
  if (TEST_FILE.test(rel)) return false;
  if (rel.endsWith(".prisma")) return true;
  if (ROUTE_FILE.test(rel)) return true;
  return MODEL_FILE.test(rel) && MODEL_HINT.test(rel);
}

/** Filter + cap a repo's file list to the schema-bearing subset. */
export function schemaCandidates(paths: string[], cap = 300): string[] {
  return paths.filter(isSchemaCandidate).slice(0, cap);
}
