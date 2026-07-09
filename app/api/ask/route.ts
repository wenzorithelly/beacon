import { statSync } from "node:fs";
import { z } from "zod";
import { askHash, clearPendingAsk, pushAsk, readPendingAsk, transcriptShowsAnswered } from "@/lib/ask-store";
import { MIRROR_TTL_MS } from "@/lib/constants";
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

const optionSchema = z.object({ label: z.string(), description: z.string().optional() });
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
  z.object({
    kind: z.literal("question"),
    question: questionSchema,
    mode: z.enum(["interactive", "mirror"]).optional(),
    transcriptPath: z.string().optional(),
  }),
  z.object({ kind: z.literal("approval"), approval: approvalSchema }),
]);

// A mirror is a read-only aid; drop it once the terminal answered it, OR once it's clearly stale
// (abandoned/interrupted — never answered, or the transcript is gone). Answered is detected by
// scanning ONLY the transcript written AFTER the mirror was pushed (transcriptOffset), so a prior
// identical question can't false-clear a re-ask. 1MB from the offset covers it: the native picker
// blocks the agent, so only this question's tool_use + its answer land between push and answer.
function mirrorResolved(ask: NonNullable<ReturnType<typeof readPendingAsk>>, now: number): boolean {
  if (now - ask.createdAt > MIRROR_TTL_MS) return true; // stale backstop
  if (!ask.transcriptPath || !ask.question) return false;
  try {
    const since = readFileRange(ask.transcriptPath, ask.transcriptOffset ?? 0, 1_048_576);
    return transcriptShowsAnswered(since, ask.question.question);
  } catch {
    return false; // transcript unreadable → rely on the TTL backstop
  }
}

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () => {
    const ask = readPendingAsk();
    const delivererLive = isDelivererLive(Date.now());
    if (ask?.mode === "mirror" && mirrorResolved(ask, Date.now())) {
      clearPendingAsk(); // sync since the read above — no ask can interleave
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
      return Response.json(
        pushAsk(
          {
            kind: "question",
            hash: askHash("question", body.question),
            question: body.question,
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
