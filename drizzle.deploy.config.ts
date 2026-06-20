import { defineConfig } from "drizzle-kit";

// The global "deploy DB" (Neon Postgres) — its OWN dialect, schema, and migrations dir, fully
// separate from the per-workspace SQLite (drizzle.config.ts). Holds the shared-board snapshots AND
// the anonymous telemetry machines (one shared DB, one env: FEEDBACK_DATABASE_URL). DDL runs over
// the UNPOOLED url. Generate: `bun run db:generate:deploy`; apply: `bun run db:migrate:deploy`.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./lib/deploy-db/schema.ts", "./lib/telemetry/schema.ts"],
  out: "./drizzle-deploy",
  dbCredentials: {
    url: process.env.FEEDBACK_DATABASE_URL_UNPOOLED ?? process.env.FEEDBACK_DATABASE_URL ?? "",
  },
});
