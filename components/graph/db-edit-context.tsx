"use client";

import { createContext, useContext } from "react";
import type { DbColumnPayload } from "@/components/graph/db-types";

// Lets a draft table/endpoint node on /db edit itself inline without prop-drilling. Every
// call mutates the client-held draft document (with undo/redo history) in db-map-client —
// nothing is persisted to the database until the user hits "Aprovar".
export interface DbEditApi {
  /** Read-only board (shared public view / archived plan history): tables/endpoints render but
      can't be edited, and they stay visible at far zoom (no region summaries to fall back on). */
  readOnly?: boolean;
  patchEndpoint: (
    id: string,
    fields: { method?: string; path?: string; domain?: string | null; description?: string | null },
  ) => void;
  deleteEndpoint: (id: string) => void;
  patchTable: (
    id: string,
    fields: { name?: string; domain?: string | null; columns?: DbColumnPayload[] },
  ) => void;
  deleteTable: (id: string) => void;
  // A real (already-persisted) endpoint — deleted on the server, not in the local draft.
  deleteRealEndpoint: (id: string) => void;
}

export const DbEditContext = createContext<DbEditApi | null>(null);

export function useDbEdit(): DbEditApi {
  const ctx = useContext(DbEditContext);
  if (!ctx) throw new Error("useDbEdit must be used inside DbEditContext");
  return ctx;
}
