import { eq, sql } from "drizzle-orm";
import { feedbackDb } from "@/lib/feedback/db";
import { feedback } from "@/lib/feedback/schema";
import { voteDirSchema } from "@/lib/feedback/validation";
import { corsJson, corsPreflight } from "@/lib/feedback/http";

// Increment the up/down counter for one feedback row. Voting is anonymous; the browser
// (localStorage) is what prevents double-voting, so the server just bumps the counter.

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  let dir: "up" | "down";
  try {
    dir = voteDirSchema.parse(await req.json()).dir;
  } catch {
    return corsJson({ error: "invalid vote" }, { status: 400 });
  }
  try {
    const [row] = await feedbackDb()
      .update(feedback)
      .set(
        dir === "up"
          ? { upvotes: sql`${feedback.upvotes} + 1` }
          : { downvotes: sql`${feedback.downvotes} + 1` },
      )
      .where(eq(feedback.id, id))
      .returning();
    if (!row) return corsJson({ error: "not found" }, { status: 404 });
    return corsJson({ feedback: row });
  } catch {
    return corsJson({ error: "feedback unavailable" }, { status: 503 });
  }
}
