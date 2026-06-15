import { pinned } from "@/lib/api-workspace";
import { db } from "@/lib/db-drizzle";
import { getFlag } from "@/lib/feature-flags";
import { decideEdit, getActiveContract } from "@/lib/scope-contract";
import { toRepoRelative } from "@/lib/touched-files";
import { repoRoot } from "@/lib/project";
import { blastRadius } from "@/lib/code-graph";

export const dynamic = "force-dynamic";

// The pre-edit gate's decision endpoint. The `beacon guard` PreToolUse hook calls it before every
// Edit/Write with the target file and returns the decision verbatim: allow vs ask against the
// active scope contract. Pinned so it hits the agent's repo workspace. (Fail-open lives in the
// hook — any error / unreachable daemon → allow, so editing never hangs.)
export const GET = pinned(async (req: Request) => {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  const flag = await getFlag("scope-guard");
  if (!flag.enabled) return Response.json({ decision: "allow" });
  const contract = await getActiveContract();
  if (!contract) return Response.json({ decision: "allow" });

  const rel = toRepoRelative(file, repoRoot()) ?? file;

  // Tolerance widens the allowed set to the declared files' depth-N import blast radius, so edits
  // to tightly-coupled files don't all prompt. Default 0 = exact declared files only.
  const tolerance = typeof flag.config.tolerance === "number" ? flag.config.tolerance : 0;
  let extraAllowed: string[] = [];
  if (tolerance > 0 && contract.declaredFiles.length) {
    const radii = await Promise.all(
      contract.declaredFiles.map((f) => blastRadius(db, f, { depth: tolerance }).catch(() => null)),
    );
    extraAllowed = radii.flatMap((r) =>
      r
        ? [
            ...r.imports.map((i) => i.to),
            ...r.importedBy.map((i) => i.from),
            ...r.transitive.upstream.map((n) => n.path),
            ...r.transitive.downstream.map((n) => n.path),
          ]
        : [],
    );
  }

  return Response.json(decideEdit({ filePath: rel, enabled: flag.enabled, contract, extraAllowed }));
});
