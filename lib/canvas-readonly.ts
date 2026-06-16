// Where a canvas drag-stop should persist the node's new position. A read-only canvas (the public
// shared board view, or an archived plan) is a FROZEN snapshot: it must never persist a drag,
// because the workspace /api routes it would call don't even exist on the public deploy. This is
// the single source of truth DbMapClient.onNodeDragStop consults so the read-only guard can't be
// forgotten at the write site.

export type DragPersistTarget = "annotation" | "draft" | "real" | "none";

export function canvasDragPersistTarget(input: {
  readOnly?: boolean;
  nodeId: string;
  isDraft: boolean;
  // Standalone /map only: persistent board annotations are on (boardAnnotations prop provided).
  boardMode: boolean;
}): DragPersistTarget {
  // Read-only wins over everything — nothing a viewer drags is ever written back.
  if (input.readOnly) return "none";
  if (input.nodeId.startsWith("anno-")) return input.boardMode ? "annotation" : "none";
  if (input.isDraft) return "draft";
  return "real";
}
