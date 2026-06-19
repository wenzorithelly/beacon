import { runWithWorkspace } from "@/lib/db-drizzle";
import { resolveLessonVerdict } from "@/lib/lesson-resolve";
import { readCurrentLesson } from "@/lib/lesson-store";
import { renderQuestions } from "@/lib/lesson-feedback";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The single verdict source the blocking beacon_explain poll reads — the lesson analog of
// /api/plan/verdict. Pinned so the poll reads the agent's repo's lesson state. On `questions` it
// also attaches the rendered markdown (node titles resolved from the live lesson) so the tool
// hands the agent ready-to-answer text without a second round-trip.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const r = resolveLessonVerdict();
    if (r.kind === "questions") {
      const lesson = readCurrentLesson();
      const titles = new Map((lesson?.nodes ?? []).map((n) => [n.id, n.title]));
      return Response.json({ ...r, rendered: renderQuestions(r.questions, titles) });
    }
    return Response.json(r);
  });
}
