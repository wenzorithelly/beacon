import { and, eq } from "drizzle-orm";
import { feedbackDb } from "@/lib/feedback/db";
import { feedback } from "@/lib/feedback/schema";
import { corsJson, corsPreflight } from "@/lib/feedback/http";

// Delete one feedback row — but only its creator can. Ownership is the per-submission delete
// token (minted on create, returned only to the submitter, kept in their browser). The public
// ids alone are useless for deletion, so nobody can grief-delete someone else's post.
export const dynamic = "force-dynamic";

export function OPTIONS(): Response {
  return corsPreflight();
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const token = req.headers.get("x-feedback-token");
  if (!token) return corsJson({ error: "missing token" }, { status: 401 });
  try {
    const deleted = await feedbackDb()
      .delete(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.deleteToken, token)))
      .returning({ id: feedback.id });
    if (deleted.length === 0) return corsJson({ error: "not found" }, { status: 404 });
    return corsJson({ ok: true });
  } catch {
    return corsJson({ error: "feedback unavailable" }, { status: 503 });
  }
}
