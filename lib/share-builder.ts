import { ensureBoardArranged } from "@/lib/map-ops";
import { ensureDbBoardArranged } from "@/lib/board-arrange";
import { readRoadmapBoard, readDbBoard } from "@/lib/board-readers";
import { resolveHasFrontend } from "@/lib/project-meta";
import { repoName } from "@/lib/project";
import {
  SHARE_SNAPSHOT_VERSION,
  type BoardsSnapshot,
  type BoardTab,
} from "@/lib/share-snapshot";

// Serialize the SELECTED live boards of the ACTIVE workspace into a "boards" snapshot. Runs on the
// local daemon inside a pinned workspace context (the /api/share/create route). It arranges each
// selected board first so node/table positions are persisted, then reads them via the shared
// board-readers — the snapshot carries x,y so the public viewer never re-runs server layout. A
// shared board is the COMMITTED reality, so the DB tab carries no in-flight draft.
export async function buildBoardsSnapshot(
  selectedTabs: BoardTab[],
  now: number = Date.now(),
): Promise<BoardsSnapshot> {
  const want = new Set(selectedTabs);
  const snapshot: BoardsSnapshot = {
    kind: "boards",
    version: SHARE_SNAPSHOT_VERSION,
    createdAt: now,
    workspaceLabel: repoName(),
    // Keep the requested order, but drop any tab we don't actually fill below.
    selectedTabs: [],
  };

  // hasFrontend gates the layer badges on the map cards — read once, reused by both map boards.
  const hasFrontend =
    want.has("ROADMAP") || want.has("ARCHITECTURE") ? await resolveHasFrontend() : false;

  if (want.has("ROADMAP")) {
    await ensureBoardArranged("ROADMAP");
    const { nodes, edges } = await readRoadmapBoard("ROADMAP");
    snapshot.roadmap = { nodes, edges, hasFrontend };
    snapshot.selectedTabs.push("ROADMAP");
  }

  if (want.has("ARCHITECTURE")) {
    await ensureBoardArranged("ARCHITECTURE");
    const { nodes, edges } = await readRoadmapBoard("ARCHITECTURE");
    snapshot.architecture = { nodes, edges, hasFrontend };
    snapshot.selectedTabs.push("ARCHITECTURE");
  }

  if (want.has("DATABASE")) {
    await ensureDbBoardArranged();
    const { tables, relations, endpoints } = await readDbBoard();
    snapshot.database = { tables, relations, endpoints, draft: null };
    snapshot.selectedTabs.push("DATABASE");
  }

  return snapshot;
}
