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
  /** Persist fields through the tab-pinned PATCH /api/nodes/{id}: optimistic local update,
      awaited write, rollback to the prior values on failure. THE path for any mutation that
      must land in the workspace THIS TAB is viewing — server actions only see the browser-wide
      beacon_ws cookie, never the tab's ?ws / x-beacon-workspace pin, so they write to the
      wrong db in a differently-pinned tab (the accept-suggestion bug class). */
  saveFields: (id: string, fields: Record<string, unknown>) => Promise<void>;
  isExpanded: (id: string) => boolean;
  toggleExpand: (id: string) => void;
  openDetailed: (id: string) => void; // the "super detailed" panel (sidebar)
  /** Open the distraction-free focus editor for a node's description (blurred-board modal). */
  openFocus: (payload: FocusEditPayload) => void;
  /** Delete: optimistic local removal + awaited tab-pinned DELETE; restores the card if the
      write fails. No revalidation — callers refresh if they need server truth. */
  removeNode: (id: string) => Promise<void>;
  /** Accept an init/AI suggestion: flip source INIT→MANUAL (optimistic local update +
      the tab-pinned PATCH; rolls back if the write fails) so a re-init keeps the card. */
  acceptSuggestion: (id: string) => Promise<void>;
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
