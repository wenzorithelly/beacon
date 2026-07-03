import { pinned } from "@/lib/api-workspace";
import { addDiffComment, listDiffComments, removeDiffComment } from "@/lib/diff-comments";

export const dynamic = "force-dynamic";

// Line-comments the user leaves on the Changes diff while the agent executes a plan.
//   GET  /api/changes/comment?file=…  → that file's comments (the UI renders them as pins/cards)
//   POST /api/changes/comment         → add one { file, line, side?, body }
//   DELETE /api/changes/comment?id=…  → remove one
// Pinned so comments land in the repo the tab is viewing (the one the agent is working in). The
// PreToolUse guard hook drains undelivered comments via /api/changes/comment/claim.
export const GET = pinned(async (req: Request) => {
  const file = new URL(req.url).searchParams.get("file") || undefined;
  return Response.json({ comments: listDiffComments(file) });
});

export const POST = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as {
    file?: string;
    line?: number;
    side?: "old" | "new";
    body?: string;
  };
  const file = (b.file ?? "").trim();
  const text = (b.body ?? "").trim();
  const line = Number(b.line);
  if (!file || !text || !Number.isFinite(line) || line < 1) {
    return Response.json({ error: "file, line and body are required" }, { status: 400 });
  }
  return Response.json({ comment: addDiffComment({ file, line, side: b.side, body: text }) });
});

export const DELETE = pinned(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) removeDiffComment(id);
  return Response.json({ ok: true });
});
