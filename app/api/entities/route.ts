import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Lets the Beacon MCP surface the project's planning data to a Claude Code session:
// features (roadmap), architecture components, bugs, db tables, endpoints.
export async function GET(req: Request) {
  const kind = new URL(req.url).searchParams.get("kind") || "features";

  if (kind === "features" || kind === "architecture") {
    const view = kind === "architecture" ? "ARCHITECTURE" : "ROADMAP";
    const nodes = await db.node.findMany({
      where: { view },
      orderBy: [{ cluster: "asc" }, { y: "asc" }],
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

  if (kind === "bugs") {
    const bugs = await db.bug.findMany({ include: { node: { select: { title: true } } } });
    return Response.json({
      items: bugs.map((b) => ({
        id: b.id,
        title: b.title,
        severity: b.severity,
        status: b.status,
        detail: b.detail,
        sourceRef: b.sourceRef,
        feature: b.node?.title ?? null,
      })),
    });
  }

  if (kind === "tables") {
    const tables = await db.dbTable.findMany({ include: { columns: { orderBy: { ord: "asc" } } } });
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
        })),
      })),
    });
  }

  if (kind === "endpoints") {
    const eps = await db.endpoint.findMany();
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

  return new Response("unknown kind (features|architecture|bugs|tables|endpoints)", {
    status: 400,
  });
}
