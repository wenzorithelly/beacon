import { blastRadius } from "@/lib/code-graph";
import { codeGraphFreshness } from "@/lib/code-graph-freshness";
import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

// "Blast radius" for a single file: 1-hop imports + importedBy (unchanged), PLUS
// transitive depth-N reachability both directions and hub/centrality scoring, plus
// every feature/component that has attached this file. The answer to "I'm about to
// touch this — what else cares?" without grepping the repo. `?depth=` (default 2,
// cap 5) controls how far the transitive walk goes.

export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), () => handle(req));
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) {
    return new Response("missing ?path=", { status: 400 });
  }
  const depthRaw = Number(url.searchParams.get("depth"));
  const depth = Number.isFinite(depthRaw) && depthRaw > 0 ? depthRaw : undefined;

  const [radius, codeGraph] = await Promise.all([
    blastRadius(db, path, { depth }),
    codeGraphFreshness(req),
  ]);
  if (!radius.exists) {
    return Response.json({
      ...radius,
      attachedTo: [],
      codeGraph,
      note: "Beacon doesn't have this file indexed. The intel watcher may not have run yet, or the path is wrong (paths are repo-relative POSIX).",
    });
  }

  const attachments = await db.query.nodeFile.findMany({
    where: (t, { eq }) => eq(t.path, path),
    with: {
      node: {
        columns: { id: true, view: true, title: true, cluster: true, status: true, role: true },
      },
    },
  });

  return Response.json({
    ...radius,
    attachedTo: attachments.map((a) => ({
      id: a.node.id,
      view: a.node.view,
      title: a.node.title,
      cluster: a.node.cluster,
      status: a.node.status,
      role: a.node.role,
    })),
    codeGraph,
  });
}
