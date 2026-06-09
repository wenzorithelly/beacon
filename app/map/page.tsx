import { sql } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { healRoadmapLayout } from "@/lib/map-ops";
import { MapClient } from "@/components/graph/map-client";
import { FilesMapClient } from "@/components/graph/files-map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { readDraftDoc } from "@/lib/draft-store";
import { readTouched } from "@/lib/touched-files";
import { untestedFiles } from "@/lib/test-coverage";
import { featureSignals } from "@/lib/feature-signals";
import { pickWorkOnNext } from "@/lib/work-next";
import { currentWorkspace } from "@/lib/workspaces";
import { withBrowserWorkspace } from "@/lib/request-workspace";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";
import type {
  DbRelationPayload,
  DbTablePayload,
  EndpointPayload,
} from "@/components/graph/db-types";

export const dynamic = "force-dynamic";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const view =
    sp.view === "ARCHITECTURE"
      ? "ARCHITECTURE"
      : sp.view === "FILES"
        ? "FILES"
        : sp.view === "DATABASE"
          ? "DATABASE"
          : "ROADMAP";

  // Pin the render to the browser's selected workspace (beacon_ws cookie), not the global
  // active one — so a background agent activation can't swap the map out from under you.
  return withBrowserWorkspace(async () => {
    if (view === "DATABASE") {
      // DB-designer view: the same payload the old /db route fetched.
      const [tablesRaw, relationsRaw, endpointsRaw] = await Promise.all([
        db.query.dbTable.findMany({
          with: { columns: { orderBy: (c, { asc }) => asc(c.ord) } },
        }),
        db.query.dbRelation.findMany(),
        db.query.endpoint.findMany({ with: { tables: true } }),
      ]);
      const draft = readDraftDoc();
      const workspaceId = currentWorkspace()?.id ?? "default";
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
      return (
        <DbMapClient
          tables={tables}
          relations={relations}
          endpoints={endpoints}
          draft={draft}
          workspaceId={workspaceId}
        />
      );
    }

    if (view === "FILES") {
      // Code-graph view: every TS/JS file is a node, every static/dynamic import
      // is an edge. Circular edges are precomputed at ingest (Tarjan's SCC over
      // the full graph) so the renderer is purely presentational.
      const [files, edges] = await Promise.all([
        db.query.codeFile.findMany({
          columns: { path: true, x: true, y: true, lang: true, inDegree: true, outDegree: true },
        }),
        db.query.codeFileEdge.findMany({
          columns: { fromPath: true, toPath: true, circular: true },
        }),
      ]);
      return (
        <FilesMapClient
          files={files.map((f) => ({
            path: f.path,
            x: f.x,
            y: f.y,
            lang: f.lang,
            inDegree: f.inDegree,
            outDegree: f.outDegree,
          }))}
          edges={edges.map((e) => ({
            from: e.fromPath,
            to: e.toPath,
            circular: e.circular,
          }))}
          touched={readTouched()}
        />
      );
    }

    // Self-heal the roadmap layout: organically re-arrange the board (d3-force) when its structure
    // changed since the last layout, so an OLD board fixes itself on first open and new features
    // settle in sensibly. Signature-gated (see healRoadmapLayout) so a refresh / drag / Group-by is
    // left alone. Runs before the read so the payload reflects the healed positions immediately.
    if (view === "ROADMAP") await healRoadmapLayout();

    const nodes = await db.query.node.findMany({
      where: (n, { eq }) => eq(n.view, view),
      // createdAt order is the deterministic tie-break for "work on next".
      orderBy: (n, { asc }) => asc(n.createdAt),
      with: {
        nodeTags: { with: { tag: { columns: { label: true } } } },
        files: { columns: { path: true }, orderBy: (f, { asc }) => asc(f.path) },
      },
    });
    // Filter edges to those whose BOTH endpoints are nodes of this view. The relational
    // query API can't filter by a related field, so resolve the view's node ids first and
    // intersect. (Empty view → no edges.)
    const viewNodeIds = sql`(select "id" from "Node" where "view" = ${view})`;
    const dbEdges = await db.query.edge.findMany({
      where: (e, { and: a, inArray: inArr }) =>
        a(inArr(e.fromId, viewNodeIds), inArr(e.toId, viewNodeIds)),
    });

    // Per-feature rollup signals (untested files / auth touch) for the card badges — computed
    // deterministically from the live code graph. No AI, no CLI.
    const [cgFiles, cgEdges] = await Promise.all([
      db.query.codeFile.findMany({ columns: { path: true } }),
      db.query.codeFileEdge.findMany({ columns: { fromPath: true, toPath: true } }),
    ]);
    const untestedSet = untestedFiles(
      cgFiles.map((f) => f.path),
      cgEdges.map((e) => ({ from: e.fromPath, to: e.toPath })),
    );

    const payload: MapNodePayload[] = nodes.map((n) => ({
      id: n.id,
      view: n.view,
      cluster: n.cluster,
      title: n.title,
      role: n.role,
      plain: n.plain,
      status: n.status,
      priority: n.priority,
      x: n.x,
      y: n.y,
      source: n.source,
      sourceRef: n.sourceRef,
      parentId: n.parentId,
      isCriterion: n.nodeTags.some((nt) => nt.tag.label === "criterion"),
      files: n.files.map((f) => f.path),
      signals: featureSignals(n.files.map((f) => f.path), untestedSet),
    }));

    const edges: MapEdgePayload[] = dbEdges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      kind: e.kind,
      label: e.label,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

    // Deterministically pick the next feature to work on (roadmap only) so the board can mark
    // it and offer a jump-to. No AI/CLI — pure status/priority/dependency ordering.
    const workOnNextId =
      view === "ROADMAP"
        ? pickWorkOnNext(
            payload.map((n) => ({
              id: n.id,
              parentId: n.parentId,
              status: n.status,
              priority: n.priority,
            })),
            edges.map((e) => ({ fromId: e.fromId, toId: e.toId, kind: e.kind })),
          )
        : null;

    return (
      <MapClient view={view} nodes={payload} edges={edges} workOnNextId={workOnNextId} />
    );
  });
}
