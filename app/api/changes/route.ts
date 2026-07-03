import { pinned } from "@/lib/api-workspace";
import { db } from "@/lib/db-drizzle";
import { computeChanges, readFileDiff } from "@/lib/changes";
import { readViewedMap } from "@/lib/viewed-files";

export const dynamic = "force-dynamic";

// Working-tree changes for the live Changes view. Pinned so it reads the workspace the tab is
// viewing. Ephemeral — shells git, persists nothing.
//   GET /api/changes                     → the change LIST (status + ± counts + symbols),
//                                          enriched with importer counts + the viewed map.
//   GET /api/changes?path=…&old=…        → one file's raw unified diff for the renderer.
export const GET = pinned(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  const path = params.get("path");
  if (path) return Response.json(readFileDiff(path, params.get("old") || null));
  const c = computeChanges();
  // Importer counts from the live code graph — the "does this break something elsewhere?" signal.
  const degrees = new Map(
    (await db.query.codeFile.findMany({ columns: { path: true, inDegree: true } })).map((r) => [r.path, r.inDegree]),
  );
  return Response.json({
    repo: c.repo,
    files: c.files.map((f) => ({ ...f, inDegree: degrees.get(f.path) ?? 0 })),
    touched: c.touched,
    viewed: readViewedMap(),
  });
});
