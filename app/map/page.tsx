import { db } from "@/lib/db-drizzle";
import { readDbBoard, readRoadmapBoard } from "@/lib/board-readers";
import { ensureBoardArranged } from "@/lib/map-ops";
import { resolveClassificationRoots, resolveHasFrontend } from "@/lib/project-meta";
import { ensureDbBoardArranged } from "@/lib/board-arrange";
import { readBoardLayout } from "@/lib/board-layout-state";
import type { RoadmapGroupBy } from "@/lib/roadmap-layout";
import { MapClient } from "@/components/graph/map-client";
import { MapTabsShell } from "@/components/graph/map-tabs-shell";
import { FilesMapClient } from "@/components/graph/files-map-client";
import { DbMapClient } from "@/components/graph/db-map-client";
import { readDraftDoc } from "@/lib/draft-store";
import { listBoardAnnotations } from "@/lib/board-annotations";
import type { BoardAnnotationPayload } from "@/components/graph/annotation-node";
import { readTouched } from "@/lib/touched-files";
import { rankWorkOrder } from "@/lib/work-next";
import { blastMetrics } from "@/lib/blast-metrics";
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

    if (view === "FILES") {
      // Code-graph view: every TS/JS file is a node, every static/dynamic import is an edge.
      // Kept as a STANDALONE page (not in the tab shell) because its node count scales with the
      // repo — eager-loading it on every roadmap/db visit would regress large monorepos. Circular
      // edges are precomputed at ingest (Tarjan's SCC) so the renderer is purely presentational.
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

    // Roadmap + Architecture + Database all live in ONE shell so switching between them is instant
    // (client-side toggle, no remount/refetch/fitView). All three are bounded by curated planning
    // entities — modest payloads — so we render every board up front and let the shell keep the
    // visited ones mounted. `view` only seeds which one starts active.

    // Organized by default: the one-shot arrange (sig-gated) tidies each board into labeled groups
    // the first time this algo version sees it; after that the user's arrangement is never moved.
    await ensureBoardArranged("ROADMAP");
    await ensureBoardArranged("ARCHITECTURE");
    await ensureDbBoardArranged();

    const hasFrontend = await resolveHasFrontend();

    // ── Roadmap board ────────────────────────────────────────────────────────────────────────
    const { nodes: roadmapNodes, edges: roadmapEdges } = await readRoadmapBoard("ROADMAP");
    // The dimension the roadmap is currently grouped by — drives the lane regions on load. A stale
    // stored "layer" (the removed dimension — stripes carry layer now) resolves to null.
    const initialArrangedBy: RoadmapGroupBy | null = ((): RoadmapGroupBy | null => {
      const by = readBoardLayout("roadmap").arrangedBy;
      return by === "cluster" || by === "status" || by === "priority" ? by : null;
    })();
    const roadmapCollapsed = readBoardLayout("roadmap").collapsed;
    // Deterministically enumerate the next few features to work on so the board can number them
    // 1·2·3 and offer a jump-to. No AI/CLI — pure status/priority/dependency ordering.
    const workOrder = rankWorkOrder(
      roadmapNodes.map((n) => ({
        id: n.id,
        parentId: n.parentId,
        status: n.status,
        priority: n.priority,
      })),
      roadmapEdges.map((e) => ({ fromId: e.fromId, toId: e.toId, kind: e.kind })),
      3,
    );

    // ── Architecture board ───────────────────────────────────────────────────────────────────
    const { nodes: archNodes, edges: archEdges } = await readRoadmapBoard("ARCHITECTURE");
    const archCollapsed = readBoardLayout("architecture").collapsed;
    // Blast-radius metrics for the architecture cards: distinct external files importing into /
    // depended on by each component's attached files (from the live code graph). Computed once
    // per render on the server; roadmap cards never carry it.
    const codeEdges = await db.query.codeFileEdge.findMany({
      columns: { fromPath: true, toPath: true },
    });
    const archNodesEnriched = archNodes.map((n) =>
      n.files.length > 0 ? { ...n, ...blastMetrics(n.files, codeEdges) } : n,
    );

    // ── Database board ───────────────────────────────────────────────────────────────────────
    const { tables, relations, endpoints } = await readDbBoard();
    const draft = readDraftDoc();
    const workspaceId = currentWorkspace()?.id ?? "default";

    return (
      <MapTabsShell
        initialView={view}
        roadmap={
          <MapClient
            view="ROADMAP"
            nodes={roadmapNodes}
            edges={roadmapEdges}
            workOrder={workOrder}
            boardAnnotations={boardAnnotations}
            initialArrangedBy={initialArrangedBy}
            initialCollapsed={roadmapCollapsed}
            hasFrontend={hasFrontend}
          />
        }
        architecture={
          <MapClient
            view="ARCHITECTURE"
            nodes={archNodesEnriched}
            edges={archEdges}
            workOrder={[]}
            boardAnnotations={boardAnnotations}
            initialArrangedBy={null}
            initialCollapsed={archCollapsed}
            hasFrontend={hasFrontend}
          />
        }
        database={
          <DbMapClient
            tables={tables}
            relations={relations}
            endpoints={endpoints}
            draft={draft}
            workspaceId={workspaceId}
            boardAnnotations={boardAnnotations}
          />
        }
      />
    );
  });
}
