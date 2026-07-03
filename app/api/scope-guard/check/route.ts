import { pinned } from "@/lib/api-workspace";
import { decideEdit, getActiveContract } from "@/lib/scope-contract";
import { toRepoRelative } from "@/lib/touched-files";
import { repoRoot } from "@/lib/project";

export const dynamic = "force-dynamic";

// The pre-edit gate's decision endpoint. The `beacon guard` PreToolUse hook calls it before every
// Edit/Write with the target file and returns the decision verbatim: allow vs ask against the
// active plan's scope contract. The guard is core plan-lifecycle behavior now — always on, no
// flag: every approved plan has a contract (declaredFiles ∪ authorizedExtras), so an edit outside
// it pauses for the user's authorization. Fail-open: no active contract, or an empty one, → allow,
// so editing never hangs (the hook also fails open on any error / unreachable daemon).
export const GET = pinned(async (req: Request) => {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const contract = await getActiveContract();
  if (!contract) return Response.json({ decision: "allow" });
  const rel = toRepoRelative(file, repoRoot()) ?? file;
  return Response.json(decideEdit({ filePath: rel, contract }));
});
