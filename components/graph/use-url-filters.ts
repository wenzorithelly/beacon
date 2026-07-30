"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  EMPTY_BOARD_FILTERS,
  mergeFilterParams,
  parseFilters,
  serializeFilters,
  type BoardFilterState,
} from "@/lib/filter-url";

/**
 * Read the board's filter state out of the CURRENT url. Returns the empty state on the server
 * (no window), so it is safe to call anywhere — but do NOT seed useState with it: the server
 * render would disagree with the client's and hydration would mismatch. Seeding is what
 * `useUrlFilters`' `apply` callback is for; this export exists for callers that need the
 * parsed state on its own.
 */
export function readUrlFilters(): BoardFilterState {
  if (typeof window === "undefined") return EMPTY_BOARD_FILTERS;
  return parseFilters(window.location.search);
}

export interface UrlFilterOptions {
  /** False = do nothing at all (embedded /plan boards, shared snapshots, archived history —
   *  anywhere the URL isn't the board's own). Default true. */
  enabled?: boolean;
  /** Wait this long after the last change before touching the URL, so chip-toggling doesn't
   *  thrash history. Default 250ms. */
  debounceMs?: number;
}

/**
 * Two-way-ish sync between the board's filter state and the query string:
 *
 *  • ON MOUNT (layout effect, before paint) the URL is parsed once and handed to `apply` so
 *    the caller can seed its state. Layout-effect rather than a useState initializer because
 *    this component is server-rendered: seeding during render would produce a filtered client
 *    tree against an unfiltered server tree.
 *  • ON CHANGE the state is written back with `history.replaceState` — the documented Next 16
 *    shallow-routing escape hatch (docs/01-app/02-guides/single-page-applications.md). It
 *    updates the router's URL WITHOUT a server round-trip. `router.replace()` would re-run the
 *    /map RSC (a fresh db read + full board re-render) on every chip toggle — never use it
 *    here. replaceState (not pushState) keeps the back button pointing at the previous PAGE
 *    rather than the previous filter permutation.
 *
 * Params the page's server component owns (`?ws=`, `?view=`) are preserved — see
 * mergeFilterParams.
 */
export function useUrlFilters(
  state: BoardFilterState,
  apply: (seed: BoardFilterState) => void,
  { enabled = true, debounceMs = 250 }: UrlFilterOptions = {},
): void {
  // Latest values, mirrored so the write effect can depend on the serialized STRING instead of
  // the state object — map-client rebuilds that object every render (60×/s during a drag) and
  // a re-running debounce would never settle.
  const stateRef = useRef(state);
  const applyRef = useRef(apply);
  useEffect(() => {
    stateRef.current = state;
    applyRef.current = apply;
  }, [state, apply]);

  const seeded = useRef(false);
  useLayoutEffect(() => {
    if (seeded.current || !enabled) return;
    seeded.current = true;
    const parsed = parseFilters(window.location.search);
    // Only disturb the caller's state if the URL actually carried filters.
    if (serializeFilters(parsed).toString()) applyRef.current(parsed);
  }, [enabled]);

  const wanted = enabled ? serializeFilters(state).toString() : "";
  useEffect(() => {
    if (!enabled || !seeded.current) return;
    const t = setTimeout(() => {
      const qs = mergeFilterParams(
        new URLSearchParams(window.location.search),
        stateRef.current,
      ).toString();
      const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
      const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (next !== now) window.history.replaceState(null, "", next);
    }, debounceMs);
    return () => clearTimeout(t);
    // `wanted` is the value-identity of `state`; stateRef supplies the object at fire time.
  }, [wanted, enabled, debounceMs]);
}
