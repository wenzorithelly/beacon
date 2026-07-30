"use client";

// The workspace's Linear status vocabulary, client-side.
//
// Once Linear is connected the whole workspace speaks the team's own status names — the detail
// modal's picker and the Columns board's columns both read them from here. Modelled as an external
// store rather than per-component state for two reasons: the list is one unchanging thing per team
// (opening ten cards must not mean ten round-trips), and a useState+useEffect pair would setState
// synchronously on a cache hit, which is the cascading render the React compiler rejects.
import { useEffect, useSyncExternalStore } from "react";
import type { LinearWorkflowState } from "@/lib/linear/types";

/** Stable identity — getSnapshot must not allocate, or React re-renders forever. */
export const NO_STATES: LinearWorkflowState[] = [];

const CACHE = new Map<string, LinearWorkflowState[]>();
const INFLIGHT = new Map<string, Promise<void>>();
const LISTENERS = new Set<() => void>();

function load(key: string, teamId: string | undefined): void {
  if (CACHE.has(key) || INFLIGHT.has(key)) return;
  const p = fetch(`/api/linear/status${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`)
    .then((r) => (r.ok ? r.json() : { states: [] }))
    .then((d: { states?: LinearWorkflowState[] }) => {
      CACHE.set(key, d.states?.length ? d.states : NO_STATES);
      for (const l of LISTENERS) l();
    })
    // A failed lookup must not wedge the picker: nothing is cached, so the next mount retries, and
    // the empty list falls back to Beacon's own statuses meanwhile.
    .catch(() => {})
    .finally(() => INFLIGHT.delete(key));
  INFLIGHT.set(key, p);
}

/**
 * The workflow states to offer for a card. Pass the card's OWN team id when it has one (a Linear
 * scope can span teams); omit it for a Beacon-native card and the workspace's primary team answers.
 * Empty until Linear is connected AND a team is resolved — callers fall back to Beacon's statuses.
 */
export function useLinearStates(teamId?: string): LinearWorkflowState[] {
  const key = teamId ?? "";
  const states = useSyncExternalStore(
    (cb) => {
      LISTENERS.add(cb);
      return () => LISTENERS.delete(cb);
    },
    () => CACHE.get(key) ?? NO_STATES,
    () => NO_STATES, // server render: no vocabulary, Beacon's statuses
  );
  useEffect(() => load(key, teamId), [key, teamId]);
  return states;
}
