import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { bumpVersion } from "@/lib/ingest";
import { clearCurrentLesson, readCurrentLesson, resetLessonRound, saveCurrentLesson } from "@/lib/lesson-store";
import { writeLessonVerdict } from "@/lib/lesson-verdict";

export const dynamic = "force-dynamic";

// "Save" — the user is done. Persist the live lesson into the library, write the saved verdict so
// the blocking beacon_explain poll ends, then clear the live state. Pinned per request.
export async function POST(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const lesson = readCurrentLesson();
    if (!lesson) return Response.json({ error: "no live lesson to save" }, { status: 400 });
    const now = Date.now();
    const lessonId = saveCurrentLesson(now);
    writeLessonVerdict({
      updatedAt: lesson.updatedAt,
      status: "saved",
      lessonId: lessonId ?? lesson.id,
      summary: `Lesson "${lesson.title}" saved to your library.`,
      decidedAt: now,
    });
    clearCurrentLesson();
    resetLessonRound();
    await bumpVersion();
    return Response.json({ ok: true, lessonId: lessonId ?? lesson.id });
  });
}
