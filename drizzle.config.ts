import { defineConfig } from "drizzle-kit";

// Dev-time tooling only (migration generation: `bun run db:generate`). The RUNTIME provisions +
// migrates in-process via lib/drizzle/provision.ts (libSQL) — never drizzle-kit.
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/drizzle/schema.ts",
  out: "./drizzle",
});
