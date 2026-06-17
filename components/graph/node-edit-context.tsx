"use client";

import { createContext, useContext } from "react";
import type { FocusEditPayload } from "@/components/graph/focus-editor-modal";

// Lets a React Flow node edit itself inline without prop-drilling. The map provides the
// implementation (optimistic local update + a no-revalidate PATCH); the node calls it.
export interface NodeEditApi {
  view: "ROADMAP" | "ARCHITECTURE";
  /** Read-only board (shared public view / archived plan history): cards render but can't be
      edited — title, category, status, description and the delete/ask actions are all locked. */
  readOnly?: boolean;
  categories: string[]; // distinct clusters in this view, for the inline picker
  statuses: readonly string[];
  /** Update fields. persist=false → local only (mid-typing); persist=true → save. */
  patch: (id: string, fields: Record<string, unknown>, persist: boolean) => void;
  isExpanded: (id: string) => boolean;
  toggleExpand: (id: string) => void;
  openDetailed: (id: string) => void; // the "super detailed" panel (sidebar)
  /** Open the distraction-free focus editor for a node's description (blurred-board modal). */
  openFocus: (payload: FocusEditPayload) => void;
  removeNode: (id: string) => void; // delete (no revalidate; local + DELETE)
  editingTitleId: string | null; // a freshly-created node to autofocus
  /** Ask the agent a question scoped to this node — opens the plan's ask composer pre-targeted
      to it. Only provided on the /plan board (the feedback loop); absent on /map. */
  onAskAgent?: (target: string) => void;
  /** Whether this workspace has a frontend — gates the frontend/backend layer badge + editor.
      Pure-backend repos never surface the layer distinction. */
  hasFrontend?: boolean;
}

export const NodeEditContext = createContext<NodeEditApi | null>(null);

export function useNodeEdit(): NodeEditApi {
  const ctx = useContext(NodeEditContext);
  if (!ctx) throw new Error("useNodeEdit must be used inside NodeEditContext");
  return ctx;
}
