import { z } from "zod";
import { advancePendingAsk, markAskDelivered, readPendingAskById } from "@/lib/ask-store";
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
  // v4: `selected[0]` is literal typed text for Claude Code's "Type something" row, not a label.
  freeText: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    return await runWithWorkspace(workspaceIdFromRequest(req), async () => {
      const now = Date.now();
      if (!isDelivererLive(now)) {
        return new Response("no live deliverer for this workspace", { status: 409 });
      }
      // By id, not "is it the head": several asks can be pending at once and the panel is free to
      // answer any of them.
      const pending = readPendingAskById(body.id);
      if (!pending) {
        return new Response("ask is stale", { status: 409 });
      }
      if (body.questionIndex !== (pending.questionIndex ?? 0)) {
        return new Response("stale question index", { status: 409 });
      }
      // Mirrors the desktop planInjection's unsupported/unmappable set (see ask-modal.tsx's
      // multiDeliverable/freeTextable) so deliveredAt never diverges from what the consumer can
      // actually type: freeText and multiSelect are each single-question-only, freeText can't answer
      // a multiSelect question, and the digit-key mapping only reaches options 1-9.
      const q = pending.questions?.[pending.questionIndex ?? 0] ?? pending.question;
      const multiQuestion = (pending.questions?.length ?? 1) > 1;
      if (body.freeText && q?.multiSelect) {
        return new Response("freeText unsupported for a multiSelect question", { status: 409 });
      }
      if (body.freeText && multiQuestion) {
        return new Response("freeText unsupported for a multi-question ask", { status: 409 });
      }
      if (body.selected.length > 1 && !q?.multiSelect) {
        return new Response("multi-label delivery requires a multiSelect question", { status: 409 });
      }
      if (body.selected.length > 1 && multiQuestion) {
        return new Response("multiSelect delivery unsupported for a multi-question ask", { status: 409 });
      }
      if (body.freeText && (q?.options?.length ?? 0) >= 9) {
        return new Response("too many options for the freeText row to stay mappable", { status: 409 });
      }
      if (
        !body.freeText &&
        body.selected.some((label) => (q?.options ?? []).findIndex((o) => o.label === label) >= 9)
      ) {
        return new Response("option unmappable past digit 9", { status: 409 });
      }
      writeAskDelivery(body.id, body.selected, now, body.questionIndex, body.freeText);
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
