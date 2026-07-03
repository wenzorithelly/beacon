import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { pinned } from "@/lib/api-workspace";
import { decideEdit, getActiveContract } from "@/lib/scope-contract";
import { claimUndeliveredDiffComments, renderDiffCommentsForAgent } from "@/lib/diff-comments";
import { readTouched, sessionLastSeen, toRepoRelative } from "@/lib/touched-files";
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
  // `claim=1` also drains the user's undelivered diff line-comments into `additionalContext`
  // (claim-on-read), so the guard hook makes ONE request per edit instead of two. The claiming
  // session's id routes owned comments to the right session in multi-session repos.
  const additionalContext = params.get("claim")
    ? renderDiffCommentsForAgent(
        claimUndeliveredDiffComments(Date.now(), params.get("session") || undefined, sessionLastSeen(readTouched())),
      ) || undefined
    : undefined;

  const contract = await getActiveContract();
  if (!contract) return Response.json({ decision: "allow", additionalContext });
  const root = repoRoot();
  const rel = toRepoRelative(file, root) ?? file;
  const abs = isAbsolute(file) ? file : join(root, rel);
  if (!existsSync(abs)) return Response.json({ decision: "allow", additionalContext });
  return Response.json({ ...decideEdit({ filePath: rel, contract }), additionalContext });
});
