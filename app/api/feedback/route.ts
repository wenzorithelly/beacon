import { desc, sql } from "drizzle-orm";
import { feedbackDb } from "@/lib/feedback/db";
import { feedback } from "@/lib/feedback/schema";
import { feedbackBodySchema } from "@/lib/feedback/validation";
import { corsJson, corsPreflight } from "@/lib/feedback/http";

// Always hit Neon — the board changes as people post/vote, so never build-prerender or cache it.
export const dynamic = "force-dynamic";

// The global feedback board API. Runs on the deploy (which holds FEEDBACK_DATABASE_URL); the
// distributed tool's /feedback page calls it cross-origin. NOT workspace-pinned — it hits the
// shared Neon DB, not the per-workspace SQLite. 503 (not 500) when the DB env is absent so a
// local install that accidentally hits its own copy degrades clearly instead of crashing.

export function OPTIONS(): Response {
  return corsPreflight();
}

// Public shape — never leak deleteToken in the list.
const publicCols = {
  id: feedback.id,
  body: feedback.body,
  upvotes: feedback.upvotes,
  downvotes: feedback.downvotes,
  createdAt: feedback.createdAt,
};

export async function GET(): Promise<Response> {
  try {
    const rows = await feedbackDb()
      .select(publicCols)
      .from(feedback)
      .orderBy(desc(sql`${feedback.upvotes} - ${feedback.downvotes}`), desc(feedback.createdAt))
      .limit(500);
    return corsJson({ feedback: rows });
  } catch {
    return corsJson({ error: "feedback unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request): Promise<Response> {
  let body: string;
  try {
    body = feedbackBodySchema.parse((await req.json())?.body);
  } catch (e) {
    return corsJson(
      { error: e instanceof Error ? e.message : "invalid feedback" },
      { status: 400 },
    );
  }
  try {
    const [row] = await feedbackDb().insert(feedback).values({ body }).returning();
    // Hand the creator their delete token (and ONLY them — it never appears in GET).
    const { deleteToken, ...pub } = row;
    return corsJson({ feedback: pub, token: deleteToken }, { status: 201 });
  } catch {
    return corsJson({ error: "feedback unavailable" }, { status: 503 });
  }
}
