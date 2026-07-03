import { z } from "zod";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { resolveAsk } from "@/lib/ask-store";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// The global modal submits the user's answer here: a question's picked option label(s) (or a
// free-text "Other"), or an approval's allow/deny. Records the resolution + clears the pending ask
// so the modal closes; the `beacon ask` hook is polling /api/ask/verdict for it.

const answerSchema = z.object({
  id: z.string().min(1),
  selected: z.array(z.string()).optional(),
  decision: z.enum(["allow", "deny"]).optional(),
});

export async function POST(req: Request) {
  try {
    const body = answerSchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      resolveAsk({ id: body.id, selected: body.selected, decision: body.decision }, Date.now());
      return Response.json({ ok: true });
    });
  } catch (e) {
    return new Response(`ask answer failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
