"use client";

import { createContext, useContext } from "react";
import type { DbColumnPayload } from "@/components/graph/db-types";

// Lets a draft table/endpoint node on /db edit itself inline (optimistic local update +
// a no-revalidate PATCH/DELETE), without prop-drilling.
export interface DbEditApi {
  patchEndpoint: (id: string, fields: Record<string, unknown>, persist: boolean) => void;
  deleteEndpoint: (id: string) => void;
  patchTable: (
    id: string,
    fields: { name?: string; domain?: string | null; columns?: DbColumnPayload[] },
    persist: boolean,
  ) => void;
  deleteTable: (id: string) => void;
}

export const DbEditContext = createContext<DbEditApi | null>(null);

export function useDbEdit(): DbEditApi {
  const ctx = useContext(DbEditContext);
  if (!ctx) throw new Error("useDbEdit must be used inside DbEditContext");
  return ctx;
}
