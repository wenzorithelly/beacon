import { z } from "zod";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { readCurrentLesson, readQuestions, resetLessonRound, writeQuestions } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

// The user's questions for the current round — the lesson analog of /api/plan/annotations. On
// "Send questions" the tab POSTs with submitted, so resolveLessonVerdict hands them to the agent
// on its next poll. Pinned per request. (There is deliberately NO draft-autosave PUT: nothing
// ever read the drafts back, and overwriting the buffer clobbered submitted-but-unanswered
// questions — the exact "my questions never reached the agent" failure.)

const anchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), excerpt: z.string() }),
  z.object({ kind: z.literal("node"), nodeId: z.string() }),
  z.object({ kind: z.literal("overall") }),
]);

const questionSchema = z.object({
  id: z.string(),
  anchor: anchorSchema,
  question: z.string(),
  askedAt: z.number().optional().default(0),
  answer: z.string().optional(),
  answeredAt: z.number().optional(),
});

const bodySchema = z.object({ questions: z.array(questionSchema) });

// GET — hydrate the panel's pending-question state.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => Response.json(readQuestions()));
}

// POST — "Send questions": mark submitted so the agent's verdict poll picks them up. A submit with
// no real question is refused (submitted with nothing would gate the loop forever). UNIONS with
// questions already submitted and still unanswered (the agent may be mid-answer, or idle after a
// tool timeout) — a second send must ADD, never replace-and-swallow.
export async function POST(req: Request) {
  const body = bodySchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const lesson = readCurrentLesson();
    if (!lesson || lesson.status !== "live") {
      return Response.json({ error: "no active lesson to receive questions" }, { status: 409 });
    }
    const real = body.questions.filter((q) => q.question.trim());
    if (!real.length) {
      return Response.json({ error: "nothing to send — ask at least one question first" }, { status: 400 });
    }
    const existing = readQuestions();
    const sameLesson = existing.lessonId === lesson.id
      && existing.lessonCreatedAt === lesson.createdAt
      && existing.ownerSessionId === lesson.ownerSessionId;
    const ids = new Set(real.map((q) => q.id));
    const keep = sameLesson && existing.submitted ? existing.questions.filter((q) => !ids.has(q.id)) : [];
    writeQuestions({
      questions: [...keep, ...real],
      submitted: true,
      lessonId: lesson.id,
      lessonCreatedAt: lesson.createdAt,
      ...(lesson.ownerSessionId ? { ownerSessionId: lesson.ownerSessionId } : {}),
    });
    return Response.json({ ok: true, count: real.length });
  });
}

// DELETE — drop the round's questions (e.g. the user cleared them).
export async function DELETE(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    resetLessonRound();
    return new Response(null, { status: 204 });
  });
}
