import { z } from "zod";
import { advancePendingAsk, markAskDelivered, readPendingAsk } from "@/lib/ask-store";
import { writeAskDelivery } from "@/lib/ask-delivery";
import { runWithWorkspace } from "@/lib/db-drizzle";
import { isDelivererLive } from "@/lib/deliverer-registry";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Beacon clicked an ask's option AND a live deliverer exists for this workspace — hand the pick to
// it (lib/ask-delivery) instead of answering it directly. Rejects (409) when there's no live
// deliverer (the client should never have rendered a clickable button in that state — this is a
// server-side backstop, not the primary guard), when `id` no longer names the pending ask (it moved
// on or was already answered in the terminal in the meantime), or when `questionIndex` is stale (the
// client answered a question that's no longer the current one — e.g. a duplicate/racing submit).
//
// v2 multi-question: if this wasn't the LAST question in the ask's `questions[]`, ADVANCE the
// pending ask in place (same id, next question) instead of resolving it — see
// lib/ask-store.advancePendingAsk. The consumer's own poll picks up the advanced question the same
// way it always has; there's no separate "next question" signal.

const bodySchema = z.object({
  id: z.string().min(1),
  selected: z.array(z.string()).min(1),
  questionIndex: z.number().int().min(0).default(0),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const now = Date.now();
      if (!isDelivererLive(now)) {
        return new Response("no live deliverer for this workspace", { status: 409 });
      }
      const pending = readPendingAsk();
      if (!pending || pending.id !== body.id) {
        return new Response("ask is stale", { status: 409 });
      }
      if (body.questionIndex !== (pending.questionIndex ?? 0)) {
        return new Response("stale question index", { status: 409 });
      }
      writeAskDelivery(body.id, body.selected, now, body.questionIndex);
      const advanced = advancePendingAsk(body.id);
      if (!advanced) markAskDelivered(body.id, now); // last question — resolve as usual
      return Response.json({ ok: true });
    });
  } catch (e) {
    return new Response(`deliver failed: ${e instanceof Error ? e.message : "error"}`, {
      status: 400,
    });
  }
}
