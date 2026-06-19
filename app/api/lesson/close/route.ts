import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { bumpVersion } from "@/lib/ingest";
import { clearCurrentLesson, readCurrentLesson, resetLessonRound } from "@/lib/lesson-store";
import { writeLessonVerdict } from "@/lib/lesson-verdict";

export const dynamic = "force-dynamic";

// "Close" — the user ends the lesson WITHOUT saving. Writes the closed verdict so the blocking
// beacon_explain poll ends, then clears the live state. Pinned per request.
export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const lesson = readCurrentLesson();
    const now = Date.now();
    writeLessonVerdict({
      updatedAt: lesson?.updatedAt ?? now,
      status: "closed",
      summary: "The user closed the lesson without saving.",
      decidedAt: now,
    });
    clearCurrentLesson();
    resetLessonRound();
    await bumpVersion();
    return Response.json({ ok: true });
  });
}
