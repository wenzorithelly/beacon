import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pinned } from "@/lib/api-workspace";
import { decideEdit, getActiveContract } from "@/lib/scope-contract";
import { claimAndRenderForAgent } from "@/lib/diff-comments";
import { toRepoRelative } from "@/lib/touched-files";
import { repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";

// The pre-edit gate's decision endpoint. The `beacon guard` PreToolUse hook calls it before every
// Edit/Write with the target file and returns the decision verbatim: allow vs ask against the
// active plan's scope contract. The guard is core plan-lifecycle behavior now — always on, no
// flag: every approved plan has a contract (declaredFiles ∪ authorizedExtras), so an edit outside
// it pauses for the user's authorization. Fail-open: no active contract, or an empty one, → allow,
// so editing never hangs (the hook also fails open on any error / unreachable daemon).
//
// CREATES never gate: the contract protects EXISTING code from off-plan edits — a file that does
// not exist yet can't be damaged, and new-file creation is the most common legitimate agent move
// (a hook "ask" would interrupt even bypass-permissions sessions on every new file).
export const GET = pinned(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const file = params.get("file") ?? "";
  const root = repoRoot();
  // `claim=1` also drains the user's undelivered diff line-comments/questions into `additionalContext`
  // (claim-on-read), so the guard hook makes ONE request per edit instead of two. Shared with the
  // turn-end stop-hook path via claimAndRenderForAgent — same session routing + staleness note.
  const additionalContext = params.get("claim")
    ? claimAndRenderForAgent(params.get("session") || undefined) || undefined
    : undefined;

  const contract = await getActiveContract();
  if (!contract) return Response.json({ decision: "allow", additionalContext });
  const rel = toRepoRelative(file, root) ?? file;
  const abs = isAbsolute(file) ? file : join(root, rel);
  if (!existsSync(abs)) return Response.json({ decision: "allow", additionalContext });
  return Response.json({ ...decideEdit({ filePath: rel, contract }), additionalContext });
});
