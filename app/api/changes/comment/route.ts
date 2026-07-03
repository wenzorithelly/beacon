import { pinned } from "@/lib/api-workspace";
import {
  addDiffComment,
  listDiffComments,
  releaseHeldDiffComments,
  removeDiffComment,
  setDiffCommentHeld,
} from "@/lib/diff-comments";
import { readTouched } from "@/lib/touched-files";

export const dynamic = "force-dynamic";

// Line-comments the user leaves on the Changes diff while the agent executes a plan.
//   GET  /api/changes/comment?file=…  → that file's comments (the UI renders them as pins/cards)
//   POST /api/changes/comment         → add one { file, line, side?, body, text?, held? }
//   PATCH /api/changes/comment        → { id, held } toggle hold · { release: true } release batch
//   DELETE /api/changes/comment?id=…  → remove one
// Pinned so comments land in the repo the tab is viewing (the one the agent is working in). The
// PreToolUse guard hook drains undelivered comments via the scope-guard check (?claim=1) or the
// legacy /api/changes/comment/claim.
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
    text?: string;
    held?: boolean;
  };
  const file = (b.file ?? "").trim();
  const text = (b.body ?? "").trim();
  const line = Number(b.line);
  if (!file || !text || !Number.isFinite(line) || line < 1) {
    return Response.json({ error: "file, line and body are required" }, { status: 400 });
  }
  // Stamp the owning session: whoever last edited the target file is the session this comment is
  // about — the claim then delivers it there, not to whichever session edits first.
  return Response.json({
    comment: addDiffComment({
      file,
      line,
      side: b.side,
      body: text,
      text: b.text,
      held: b.held,
      owner: readTouched()[file]?.session,
    }),
  });
});

export const PATCH = pinned(async (req: Request) => {
  const b = (await req.json().catch(() => ({}))) as { id?: string; held?: boolean; release?: boolean };
  if (b.release) return Response.json({ released: releaseHeldDiffComments() });
  if (b.id && typeof b.held === "boolean") {
    setDiffCommentHeld(b.id, b.held);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "id+held or release required" }, { status: 400 });
});

export const DELETE = pinned(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) removeDiffComment(id);
  return Response.json({ ok: true });
});
