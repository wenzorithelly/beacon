import { db } from "@/lib/db-drizzle";
import { readDbBoard, readRoadmapBoard } from "@/lib/board-readers";
import { ensureBoardArranged } from "@/lib/map-ops";
import { resolveClassificationRoots, resolveHasFrontend } from "@/lib/project-meta";
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
import { rankWorkOrder } from "@/lib/work-next";
import { currentWorkspace, runWithWorkspace } from "@/lib/workspaces";
import { resolveTabWorkspaceId } from "@/lib/request-workspace";

export const dynamic = "force-dynamic";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ws?: string }>;
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

  // Pin the render to THIS tab's workspace: the per-tab `?ws=` param wins (so a /map tab keeps
  // showing its repo even after opening another repo flips the browser-wide beacon_ws cookie),
  // then the cookie, then the global active workspace — and a background agent activation can't
  // swap the map out from under you.
  return runWithWorkspace(await resolveTabWorkspaceId(sp.ws), async () => {
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
      // DB-designer view: the same payload the old /db route fetched (shared with the share builder).
      const { tables, relations, endpoints } = await readDbBoard();
      const draft = readDraftDoc();
      const workspaceId = currentWorkspace()?.id ?? "default";
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
          hasFrontend={await resolveHasFrontend()}
          classificationRoots={await resolveClassificationRoots()}
        />
      );
    }

    // Organized by default: the one-shot arrange (sig-gated, see ensureBoardArranged) tidies the
    // board into labeled groups the first time this algo version sees it; after that the user's
    // arrangement is never auto-moved. Runs before the read so the payload reflects it immediately.
    if (view === "ROADMAP" || view === "ARCHITECTURE") await ensureBoardArranged(view);
    // Whether this workspace has a frontend — gates the layer badge + the "Layer" group-by.
    const hasFrontend = await resolveHasFrontend();
    // The dimension the roadmap is currently grouped by — drives the lane regions on load.
    // A stale stored "layer" (the removed dimension — stripes carry layer now) resolves to null.
    const initialArrangedBy: RoadmapGroupBy | null =
      view === "ROADMAP"
        ? ((): RoadmapGroupBy | null => {
            const by = readBoardLayout("roadmap").arrangedBy;
            return by === "cluster" || by === "status" || by === "priority" ? by : null;
          })()
        : null;

    // Nodes + view-internal edges + per-card signals — shared with the share-snapshot builder.
    const { nodes, edges } = await readRoadmapBoard(view);

    // Persisted collapse lens (which features have their sub-tasks folded) — survives refresh AND
    // killing/reopening the session, since it lives in the per-workspace board-layout-state file.
    const initialCollapsed = readBoardLayout(view === "ROADMAP" ? "roadmap" : "architecture").collapsed;

    // Deterministically enumerate the next few features to work on (roadmap only) so the board
    // can number them 1·2·3 and offer a jump-to. No AI/CLI — pure status/priority/dependency
    // ordering, topologically valid (a dependency never trails the thing that needs it).
    const workOrder =
      view === "ROADMAP"
        ? rankWorkOrder(
            nodes.map((n) => ({
              id: n.id,
              parentId: n.parentId,
              status: n.status,
              priority: n.priority,
            })),
            edges.map((e) => ({ fromId: e.fromId, toId: e.toId, kind: e.kind })),
            3,
          )
        : [];

    return (
      <MapClient
        view={view}
        nodes={nodes}
        edges={edges}
        workOrder={workOrder}
        boardAnnotations={boardAnnotations}
        initialArrangedBy={initialArrangedBy}
        initialCollapsed={initialCollapsed}
        hasFrontend={hasFrontend}
      />
    );
  });
}
