import { sql } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { untestedFiles } from "@/lib/test-coverage";
import { featureSignals } from "@/lib/feature-signals";
import { parseExternalMeta } from "@/lib/linear/mapping";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";
import type {
  DbRelationPayload,
  DbTablePayload,
  EndpointPayload,
} from "@/components/graph/db-types";

// The board read-model, factored out of app/map/page.tsx so BOTH the live /map page AND the
// share-snapshot builder (lib/share-builder.ts) read identical payloads from one place. These
// only READ + project rows — callers decide whether to ensureBoardArranged() first (so positions
// exist) and layer on page-only concerns (workOrder, board annotations, draft, hasFrontend).

/** Roadmap/architecture nodes + the view-internal edges, with the deterministic per-card signals
 *  (untested-files / auth-touch) the cards badge. Mirrors app/map/page.tsx's ROADMAP branch. */
export async function readRoadmapBoard(
  view: "ROADMAP" | "ARCHITECTURE",
): Promise<{ nodes: MapNodePayload[]; edges: MapEdgePayload[] }> {
  const nodes = await db.query.node.findMany({
    // Exclude the DRAFT layer: a plan under review lives ONLY on /plan (which has its own
    // source="DRAFT" query). The live /map roadmap + share snapshots must show only real
    // cards — merely PRESENTING a plan must never surface its proposals here, only an
    // approval (which promotes DRAFT→MANUAL) does. Mirrors ensureBoardArranged + the
    // /api/plan dedup, which already exclude DRAFT.
    // isNull(hiddenAt): soft-hidden Linear cards (issue left the scope) stay in the DB — with their
    // position/edges/annotations — but drop off the visible board until their issue returns.
    where: (n, { and, eq, ne, isNull }) => and(eq(n.view, view), ne(n.source, "DRAFT"), isNull(n.hiddenAt)),
    // createdAt order is the deterministic tie-break for "work on next".
    orderBy: (n, { asc }) => asc(n.createdAt),
    with: {
      nodeTags: { with: { tag: { columns: { label: true } } } },
      files: { columns: { path: true }, orderBy: (f, { asc }) => asc(f.path) },
      bugFlags: { orderBy: (f, { asc }) => [asc(f.createdAt), asc(f.id)] },
    },
  });

  // Filter edges to those whose BOTH endpoints are nodes of this view. The relational query API
  // can't filter by a related field, so resolve the view's node ids first and intersect.
  const viewNodeIds = sql`(select "id" from "Node" where "view" = ${view} and "source" <> 'DRAFT' and "hiddenAt" is null)`;
  const dbEdges = await db.query.edge.findMany({
    where: (e, { and: a, inArray: inArr }) =>
      a(inArr(e.fromId, viewNodeIds), inArr(e.toId, viewNodeIds)),
  });

  // Per-feature rollup signals computed deterministically from the live code graph (no AI/CLI).
  const [cgFiles, cgEdges] = await Promise.all([
    db.query.codeFile.findMany({ columns: { path: true } }),
    db.query.codeFileEdge.findMany({ columns: { fromPath: true, toPath: true } }),
  ]);
  const untestedSet = untestedFiles(
    cgFiles.map((f) => f.path),
    cgEdges.map((e) => ({ from: e.fromPath, to: e.toPath })),
  );

  const nodePayload: MapNodePayload[] = nodes.map((n) => ({
    id: n.id,
    view: n.view,
    kind: n.kind,
    cluster: n.cluster,
    layer: n.layer,
    title: n.title,
    role: n.role,
    plain: n.plain,
    status: n.status,
    priority: n.priority,
    x: n.x,
    y: n.y,
    source: n.source,
    sourceRef: n.sourceRef,
    assigneeName: n.assigneeName,
    assigneeAvatarUrl: n.assigneeAvatarUrl,
    externalMeta: parseExternalMeta(n.externalMeta),
    parentId: n.parentId,
    isCriterion: n.nodeTags.some((nt) => nt.tag.label === "criterion"),
    files: n.files.map((f) => f.path),
    signals: featureSignals(n.files.map((f) => f.path), untestedSet),
    bugFlags: n.bugFlags.map((f) => ({
      id: f.id,
      by: f.by,
      note: f.note,
      resolved: f.resolvedAt != null,
    })),
  }));

  const edgePayload: MapEdgePayload[] = dbEdges.map((e) => ({
    id: e.id,
    fromId: e.fromId,
    toId: e.toId,
    kind: e.kind,
    label: e.label,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
  }));

  return { nodes: nodePayload, edges: edgePayload };
}

/** Tables (+ ordered columns), relations, and endpoints (+ table usage) for the /db canvas.
 *  Mirrors app/map/page.tsx's DATABASE branch. */
export async function readDbBoard(): Promise<{
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
}> {
  const [tablesRaw, relationsRaw, endpointsRaw] = await Promise.all([
    db.query.dbTable.findMany({
      with: { columns: { orderBy: (c, { asc }) => asc(c.ord) } },
    }),
    db.query.dbRelation.findMany(),
    db.query.endpoint.findMany({ with: { tables: true } }),
  ]);

  const tables: DbTablePayload[] = tablesRaw.map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    description: t.description,
    source: t.source,
    x: t.x,
    y: t.y,
    columns: t.columns.map((c) => ({
      name: c.name,
      type: c.type,
      isPk: c.isPk,
      isFk: c.isFk,
      nullable: c.nullable,
      note: c.note,
    })),
  }));
  const relations: DbRelationPayload[] = relationsRaw.map((r) => ({
    id: r.id,
    fromTableId: r.fromTableId,
    toTableId: r.toTableId,
    fromColumn: r.fromColumn,
    toColumn: r.toColumn,
    label: r.label,
  }));
  const endpoints: EndpointPayload[] = endpointsRaw.map((e) => ({
    id: e.id,
    method: e.method,
    path: e.path,
    domain: e.domain,
    description: e.description,
    source: e.source,
    x: e.x,
    y: e.y,
    tables: e.tables.map((u) => ({ tableId: u.tableId, access: u.access })),
  }));

  return { tables, relations, endpoints };
}
