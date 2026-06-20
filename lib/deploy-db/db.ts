import "server-only";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/lib/deploy-db/schema";

// Client for the global "deploy DB" (Neon Postgres over HTTP — stateless, serverless-friendly,
// no connection pool to exhaust on Vercel). The connection string lives ONLY in this server
// module's env (FEEDBACK_DATABASE_URL): it is NEVER bundled into the distributed tool. The
// deploy-side APIs (shared boards + telemetry) run where the env is set; local installs call them
// cross-origin. The env var keeps its FEEDBACK_ name so existing deploy configuration stays valid.
type DeployDB = NeonHttpDatabase<typeof schema>;

export function deployDb(): DeployDB {
  const url = process.env.FEEDBACK_DATABASE_URL;
  if (!url) throw new Error("FEEDBACK_DATABASE_URL is not set");
  const g = globalThis as unknown as { __deployDb?: DeployDB };
  if (!g.__deployDb) g.__deployDb = drizzle(neon(url), { schema });
  return g.__deployDb;
}
