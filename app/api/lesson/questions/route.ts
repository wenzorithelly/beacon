import { z } from "zod";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";
import { readQuestions, resetLessonRound, writeQuestions } from "@/lib/lesson-store";

export const dynamic = "force-dynamic";

// The user's questions for the current round — the lesson analog of /api/plan/annotations. The
// narrative panel PUTs in-progress questions whenever they edit; on "Send questions" it POSTs with
// submitted, so resolveLessonVerdict hands them to the agent on its next poll. Pinned per request.

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

// PUT — autosave in-progress questions (not yet sent). Idempotent.
export async function PUT(req: Request) {
  const body = bodySchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    writeQuestions({ questions: body.questions, submitted: false });
    return new Response(null, { status: 204 });
  });
}

// POST — "Send questions": mark submitted so the agent's verdict poll picks them up. A submit with
// no real question is refused (submitted with nothing would gate the loop forever).
export async function POST(req: Request) {
  const body = bodySchema.parse(await req.json());
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const real = body.questions.filter((q) => q.question.trim());
    if (!real.length) {
      return Response.json({ error: "nothing to send — ask at least one question first" }, { status: 400 });
    }
    writeQuestions({ questions: real, submitted: true });
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
