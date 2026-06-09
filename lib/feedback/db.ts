import "server-only";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "@/lib/feedback/schema";

// Client for the global feedback DB (Neon Postgres over HTTP — stateless, serverless-friendly,
// no connection pool to exhaust on Vercel). The connection string lives ONLY in this server
// module's env (FEEDBACK_DATABASE_URL): it is NEVER bundled into the distributed tool. The
// feedback API runs on the deploy (which has the env); local installs call that API cross-origin.
type FeedbackDB = NeonHttpDatabase<typeof schema>;

export function feedbackDb(): FeedbackDB {
  const url = process.env.FEEDBACK_DATABASE_URL;
  if (!url) throw new Error("FEEDBACK_DATABASE_URL is not set");
  const g = globalThis as unknown as { __feedbackDb?: FeedbackDB };
  if (!g.__feedbackDb) g.__feedbackDb = drizzle(neon(url), { schema });
  return g.__feedbackDb;
}
