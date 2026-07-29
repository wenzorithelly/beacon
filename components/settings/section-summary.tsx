"use client";

import { useEffect, useSyncExternalStore } from "react";
import { publishSummary, subscribeToSummaries, summaryVersion } from "@/lib/settings-summary";

// React bindings over lib/settings-summary.ts — the two hooks the settings surface uses. The store
// itself is React-free and lives in lib/ so it can be unit-tested without a renderer; this file is
// only the wiring. Same useSyncExternalStore recipe already used in settings-modal.tsx for the
// direct-modal dedup, not a new state library.

export { sectionSummary } from "@/lib/settings-summary";

/** Subscribe the rail to every summary at once. The snapshot is the store's version counter, which
 * changes whenever any fragment does; callers re-read per row with `sectionSummary(id)` during
 * render. The server snapshot is a constant, so the first client render matches the server HTML and
 * the second line appears post-hydration. */
export function useSummaryVersion(): number {
  return useSyncExternalStore(subscribeToSummaries, summaryVersion, () => 0);
}

/** Publish one fragment of a section's summary for as long as this component is mounted. Pass an
 * empty/undefined `value` to contribute nothing (e.g. before the bridge answers). */
export function useSectionSummary(sectionId: string, key: string, value: string | undefined): void {
  useEffect(() => publishSummary(sectionId, key, value), [sectionId, key, value]);
}
