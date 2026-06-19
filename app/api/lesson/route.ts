import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { bumpVersion } from "@/lib/ingest";
import { lessonInputSchema, pushLesson, readCurrentLesson } from "@/lib/lesson-store";
import { clearLessonVerdict } from "@/lib/lesson-verdict";

export const dynamic = "force-dynamic";

// GET — the open /learn surface polls this for the live lesson (and its updatedAt round signal),
// so a re-push lands in place. POST — the beacon_explain tool pushes a lesson (first round or a
// re-push carrying answers). Both pinned to the request's workspace so the agent and the browser
// read/write the same workspace's lesson file.

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () =>
    Response.json({ lesson: readCurrentLesson() }),
  );
}

export async function POST(req: Request) {
  const input = lessonInputSchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    // A fresh push supersedes any prior round: clear a stale saved/closed verdict so it can't
    // immediately terminate the new lesson, then push (which also clears the round buffer).
    clearLessonVerdict();
    const lesson = pushLesson(input);
    await bumpVersion();
    return Response.json({ ok: true, lessonId: lesson.id, updatedAt: lesson.updatedAt });
  });
}
