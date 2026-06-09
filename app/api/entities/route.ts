import { db, runWithWorkspace } from "@/lib/db-drizzle";
import { workspaceIdFromRequest } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

// Lets the Beacon MCP surface the project's planning data to a Claude Code session:
// features (roadmap), architecture components, db tables, endpoints. Pinned to
// the requesting repo so the agent reads ITS workspace, not the browser's active one.
export async function GET(req: Request) {
  return runWithWorkspace(workspaceIdFromRequest(req), () => handle(req));
}

async function handle(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") || "features";

  if (kind === "features" || kind === "architecture") {
    const view = kind === "architecture" ? "ARCHITECTURE" : "ROADMAP";
    const nodes = await db.query.node.findMany({
      where: (t, { eq }) => eq(t.view, view),
      orderBy: (t, { asc }) => [asc(t.cluster), asc(t.y)],
    });
    return Response.json({
      items: nodes.map((n) => ({
        id: n.id,
        title: n.title,
        cluster: n.cluster,
        status: n.status,
        priority: n.priority,
        role: n.role,
        plain: n.plain,
      })),
    });
  }

  if (kind === "tables") {
    const tables = await db.query.dbTable.findMany({
      with: { columns: { orderBy: (c, { asc }) => asc(c.ord) } },
    });
    return Response.json({
      items: tables.map((t) => ({
        id: t.id,
        name: t.name,
        domain: t.domain,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPk: c.isPk,
          isFk: c.isFk,
          nullable: c.nullable,
          note: c.note,
        })),
      })),
    });
  }

  if (kind === "endpoints") {
    const eps = await db.query.endpoint.findMany();
    return Response.json({
      items: eps.map((e) => ({
        id: e.id,
        method: e.method,
        path: e.path,
        domain: e.domain,
        description: e.description,
      })),
    });
  }

  return new Response("unknown kind (features|architecture|tables|endpoints)", {
    status: 400,
  });
}
