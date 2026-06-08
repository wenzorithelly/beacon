import { defineConfig } from "drizzle-kit";

// Dev-time tooling config. The RUNTIME uses bun:sqlite (lib/drizzle/client.ts); drizzle-kit only
// runs at dev time for schema introspection + migration generation.
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/drizzle/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:/tmp/beacon-introspect.sqlite" },
});
