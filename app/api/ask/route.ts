import { statSync } from "node:fs";
import { z } from "zod";
import { recordWorkspaceResumed } from "@/lib/agent-status";
import { askHash, clearPendingAsk, pushAsk, readPendingAsk, transcriptShowsAnswered } from "@/lib/ask-store";
import { ASK_DELIVERED_CLEAR_MS, MIRROR_TTL_MS } from "@/lib/constants";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { isDelivererLive } from "@/lib/deliverer-registry";
import { readFileRange } from "@/lib/read-tail";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The agent-ask bridge push + read. POST (the `beacon ask` hook) registers a pending question or
// approval, pinned to the agent's repo workspace; GET (the global modal, browser-pinned) reads
// whatever is currently awaiting the user ALONGSIDE whether a live deliverer means its options can
// actually be clicked (lib/deliverer-registry) — one round-trip instead of two. Mirrors the
// plan-loop's /api/plan push/read.

const optionSchema = z.object({ label: z.string(), description: z.string().optional(), preview: z.string().optional() });
const questionSchema = z.object({
  header: z.string().default(""),
  question: z.string(),
  multiSelect: z.boolean().default(false),
  options: z.array(optionSchema),
});
const approvalSchema = z.object({
  tool: z.string(),
  title: z.string(),
  preview: z.string(),
});
const pushSchema = z.discriminatedUnion("kind", [
  // mirror = read-only display while the TERMINAL owns the answer (question-only: approvals have no
  // transcript "answered" marker to auto-clear them, so they're never mirrored). Absent ⇒ interactive.
  // `questions`/`questionIndex` (v2 multi-question) are present only when the tool call sent more
  // than one question — `question` is always the CURRENT one, back-compat for single-question asks.
  z.object({
    kind: z.literal("question"),
    question: questionSchema,
    questions: z.array(questionSchema).optional(),
    questionIndex: z.number().int().min(0).optional(),
    mode: z.enum(["interactive", "mirror"]).optional(),
    transcriptPath: z.string().optional(),
  }),
  z.object({ kind: z.literal("approval"), approval: approvalSchema }),
]);

// A mirror is a read-only aid; drop it once it's settled. "answered" (the answer landed in the
// terminal) is detected two ways: a Beacon pick handed to a live deliverer clears a couple of
// seconds after the delivery-ack (deliveredAt — the deliverer types it within milliseconds, and
// this is the ONLY reliable signal for sessions whose transcript file Claude Code never flushes to
// disk, observed on desktop-spawned v2.1.206 sessions); a terminal-typed answer is spotted by
// scanning ONLY the transcript written AFTER the mirror was pushed (transcriptOffset), so a prior
// identical question can't false-clear a re-ask — 1MB from the offset covers it: the native picker
// blocks the agent, so only this question's tool_use + its answer land between push and answer.
// "expired" (TTL) is the abandoned/interrupted backstop — dropped, but NOT an answer signal.
// v2 multi-question: Claude Code emits ONE combined "answered" tool_result only after ALL of the
// tool call's questions are answered (see lib/ask-store's HookEvent doc), so matching `ask.question`
// (the CURRENT question, possibly already advanced past index 0 by app/api/ask/deliver) against that
// line still resolves the WHOLE ask correctly — the GET handler below calls clearPendingAsk(), which
// drops `questions`/`questionIndex` along with everything else, regardless of how far it advanced.
function mirrorResolution(
  ask: NonNullable<ReturnType<typeof readPendingAsk>>,
  now: number,
): "answered" | "expired" | null {
  if (ask.deliveredAt != null && now - ask.deliveredAt >= ASK_DELIVERED_CLEAR_MS) return "answered";
  if (now - ask.createdAt > MIRROR_TTL_MS) return "expired"; // stale backstop
  if (!ask.transcriptPath || !ask.question) return null;
  try {
    const since = readFileRange(ask.transcriptPath, ask.transcriptOffset ?? 0, 1_048_576);
    return transcriptShowsAnswered(since, ask.question.question) ? "answered" : null;
  } catch {
    return null; // transcript unreadable → rely on the delivered-ack / TTL paths
  }
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const ask = readPendingAsk();
    const delivererLive = isDelivererLive(Date.now());
    const resolution = ask?.mode === "mirror" ? mirrorResolution(ask, Date.now()) : null;
    if (ask && resolution) {
      clearPendingAsk(); // sync since the read above — no ask can interleave
      // The answer landed, so the asking session is no longer waiting on the user — flip its
      // agent-status back to "working" here (no hook fires at answer time), or the desktop
      // attention pill stays on "Needs input" until the turn ends.
      if (resolution === "answered") recordWorkspaceResumed();
      return Response.json({ ask: null, delivererLive });
    }
    return Response.json({ ask, delivererLive });
  });
}

export async function POST(req: Request) {
  try {
    const body = pushSchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      if (body.kind === "approval") {
        return Response.json(
          pushAsk({ kind: "approval", hash: askHash("approval", undefined, body.approval), approval: body.approval }, Date.now()),
        );
      }
      // Question. For a mirror, record the transcript size NOW so the answered-check scans only
      // what's written after this push (see mirrorResolved).
      let transcriptOffset: number | undefined;
      if (body.mode === "mirror" && body.transcriptPath) {
        try {
          transcriptOffset = statSync(body.transcriptPath).size;
        } catch {
          /* transcript not yet on disk → scan from 0; the TTL still backstops */
        }
      }
      // Hash the WHOLE question set for a multi-question ask (so a repush of the same set dedups as
      // one unit) — a single question hashes exactly as it always has (lib/ask-store.askHash).
      const hashBasis = body.questions && body.questions.length > 1 ? body.questions : body.question;
      return Response.json(
        pushAsk(
          {
            kind: "question",
            hash: askHash("question", hashBasis),
            question: body.question,
            questions: body.questions,
            questionIndex: body.questionIndex,
            mode: body.mode,
            transcriptPath: body.transcriptPath,
            transcriptOffset,
          },
          Date.now(),
        ),
      );
    });
  } catch (e) {
    return new Response(`ask push failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
