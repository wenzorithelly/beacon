// Beacon's data client is now Drizzle over Bun's native SQLite (see lib/db-drizzle.ts). This module
// stays as the stable import path — `import { db } from "@/lib/db"` keeps working everywhere — by
// re-exporting the Drizzle client and its per-workspace helpers. The old Prisma `Db` type name is
// aliased to the Drizzle `DB` for back-compat.
export { db, defaultDb, getDb, invalidateDb, runWithWorkspace, type DB } from "@/lib/db-drizzle";
export type { DB as Db } from "@/lib/db-drizzle";
