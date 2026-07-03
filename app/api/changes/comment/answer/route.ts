import { pinned } from "@/lib/api-workspace";
import { answerDiffComment } from "@/lib/diff-comments";

export const dynamic = "force-dynamic";

// The agent's answer to a user's Changes-view question, delivered by `beacon answer <id>` (the CLI
// channel — lowest-token: no persistent MCP schema). Fills the question's answer; the open Changes
// view surfaces it via its own comment poll (no version bump — that's a heavyweight workspace-wide
// canvas refresh, too blunt for one Q&A card). Pinned to the repo the agent ran in via the
// x-beacon-workspace header the CLI sends. First answer wins — a re-answer 404s rather than clobber.
export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { id?: string; answer?: string };
  const id = (b.id ?? "").trim();
  const answer = (b.answer ?? "").trim();
  if (!id || !answer) {
    return Response.json({ error: "id and answer are required" }, { status: 400 });
  }
  const c = answerDiffComment(id, answer);
  if (!c) return Response.json({ error: "no unanswered question with that id" }, { status: 404 });
  return Response.json({ ok: true, id: c.id, file: c.file, line: c.line });
});
