import { sql } from "drizzle-orm";
import { db } from "@/lib/db-drizzle";
import { ensureBoardArranged } from "@/lib/map-ops";
import { ensureDbBoardArranged } from "@/lib/board-arrange";
import { readBoardLayout } from "@/lib/board-layout-state";
import type { RoadmapGroupBy } from "@/lib/roadmap-layout";
import { MapClient } from "@/components/graph/map-client";
import { FilesMapClient } from "@/components/graph/files-map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { readDraftDoc } from "@/lib/draft-store";
import { listBoardAnnotations } from "@/lib/board-annotations";
import type { BoardAnnotationPayload } from "@/components/graph/annotation-node";
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
    // Persistent board annotations (pins + cards on the roadmap/architecture/database boards).
    const boardAnnotations: BoardAnnotationPayload[] = (await listBoardAnnotations()).map((a) => ({
      id: a.id,
      targetKind: a.targetKind as BoardAnnotationPayload["targetKind"],
      targetId: a.targetId,
      columnName: a.columnName,
      body: a.body,
      x: a.x,
      y: a.y,
    }));

    if (view === "DATABASE") {
      // Organized by default: one-shot domain-clustered + docked arrange (sig-gated).
      await ensureDbBoardArranged();
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
          boardAnnotations={boardAnnotations}
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
      // The Files tab ignores Python package markers (__init__.py): every package dir has one,
      // they're near-empty, and they add a web of import edges without conveying structure. We
      // hide them here (display-only) — the persisted code graph + blast-radius still keep them.
      const keptFiles = files.filter(
        (f) => f.path !== "__init__.py" && !f.path.endsWith("/__init__.py"),
      );
      const keptPaths = new Set(keptFiles.map((f) => f.path));
      const keptEdges = edges.filter(
        (e) => keptPaths.has(e.fromPath) && keptPaths.has(e.toPath),
      );
      return (
        <FilesMapClient
          files={keptFiles.map((f) => ({
            path: f.path,
            x: f.x,
            y: f.y,
            lang: f.lang,
            inDegree: f.inDegree,
            outDegree: f.outDegree,
          }))}
          edges={keptEdges.map((e) => ({
            from: e.fromPath,
            to: e.toPath,
            circular: e.circular,
          }))}
          touched={readTouched()}
        />
      );
    }

    // Organized by default: the one-shot arrange (sig-gated, see ensureBoardArranged) tidies the
    // board into labeled groups the first time this algo version sees it; after that the user's
    // arrangement is never auto-moved. Runs before the read so the payload reflects it immediately.
    if (view === "ROADMAP" || view === "ARCHITECTURE") await ensureBoardArranged(view);
    // The dimension the roadmap is currently grouped by — drives the lane regions on load.
    const initialArrangedBy: RoadmapGroupBy | null =
      view === "ROADMAP"
        ? ((): RoadmapGroupBy | null => {
            const by = readBoardLayout("roadmap").arrangedBy;
            return by === "cluster" || by === "status" || by === "priority" ? by : null;
          })()
        : null;

    const nodes = await db.query.node.findMany({
      where: (n, { eq }) => eq(n.view, view),
      // createdAt order is the deterministic tie-break for "work on next".
      orderBy: (n, { asc }) => asc(n.createdAt),
      with: {
        nodeTags: { with: { tag: { columns: { label: true } } } },
        files: { columns: { path: true }, orderBy: (f, { asc }) => asc(f.path) },
        bugFlags: { orderBy: (f, { asc }) => [asc(f.createdAt), asc(f.id)] },
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
      kind: n.kind,
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
      bugFlags: n.bugFlags.map((f) => ({
        id: f.id,
        by: f.by,
        note: f.note,
        resolved: f.resolvedAt != null,
      })),
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
      <MapClient
        view={view}
        nodes={payload}
        edges={edges}
        workOnNextId={workOnNextId}
        boardAnnotations={boardAnnotations}
        initialArrangedBy={initialArrangedBy}
      />
    );
  });
}
