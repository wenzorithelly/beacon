import { z } from "zod";
import { recordWorkspaceResumed } from "@/lib/agent-status";
import { resolveAskByToolUseId } from "@/lib/ask-store";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// PostToolUse:AskUserQuestion (bin/ask.ts) — the tool call just completed, so the mirror pushed at
// PreToolUse (if any) can be cleared NOW by the event's `tool_use_id` instead of waiting on the
// transcript scan or the deliveredAt/TTL backstops in app/api/ask's mirrorResolution. This is the
// PRIMARY "answered" signal; those backstops stay in place for asks pushed before this field existed,
// or a hook invocation that never fires. Same status-flip as the other settle paths: an answered ask
// means the asking session is no longer waiting on the user.
//
// Best-effort by design — a hook must NEVER fail the user's session over Beacon being unreachable —
// so an unknown/stale toolUseId (already cleared, an approval, or an ask predating this field) is a
// silent no-op 200, never a 500.

const bodySchema = z.object({ toolUseId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      if (resolveAskByToolUseId(body.toolUseId)) recordWorkspaceResumed();
      return Response.json({ ok: true });
    });
  } catch (e) {
    return new Response(`ask-answered failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
