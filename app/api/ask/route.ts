import { z } from "zod";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { askHash, pushAsk, readPendingAsk } from "@/lib/ask-store";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The agent-ask bridge push + read. POST (the `beacon ask` hook) registers a pending question or
// approval, pinned to the agent's repo workspace; GET (the global modal, browser-pinned) reads
// whatever is currently awaiting the user. Mirrors the plan-loop's /api/plan push/read.

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
  z.object({ kind: z.literal("question"), question: questionSchema }),
  z.object({ kind: z.literal("approval"), approval: approvalSchema }),
]);

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), async () =>
    Response.json({ ask: readPendingAsk() }),
  );
}

export async function POST(req: Request) {
  try {
    const body = pushSchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const hash =
        body.kind === "question"
          ? askHash("question", body.question)
          : askHash("approval", undefined, body.approval);
      const res =
        body.kind === "question"
          ? pushAsk({ kind: "question", hash, question: body.question }, Date.now())
          : pushAsk({ kind: "approval", hash, approval: body.approval }, Date.now());
      return Response.json(res);
    });
  } catch (e) {
    return new Response(`ask push failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
