import { defineConfig } from "drizzle-kit";

// The global feedback DB (Neon Postgres) — its OWN dialect, schema, and migrations dir, fully
// separate from the per-workspace SQLite (drizzle.config.ts). DDL runs over the UNPOOLED url.
// Generate: `bun run db:generate:feedback`; apply: `bun run db:migrate:feedback`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/feedback/schema.ts",
  out: "./drizzle-feedback",
  dbCredentials: {
    url: process.env.FEEDBACK_DATABASE_URL_UNPOOLED ?? process.env.FEEDBACK_DATABASE_URL ?? "",
  },
});
