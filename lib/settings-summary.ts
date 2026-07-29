// ── Rail-row value summaries: the store ───────────────────────────────────────────────────────
// Every settings rail row states its own current value under its label ("13px · Block · WebGL"), so
// the common question — "what is my renderer?" — is answered without opening the section.
//
// That value is a CLIENT fact (it comes from the shell bridge, or localStorage, or a fetch), but the
// rail is rendered by the modal, a sibling of the cards that know it. Rather than lift all of that
// state up and re-plumb every card, each card PUBLISHES a fragment here and the rail SUBSCRIBES.
//
// A section can have several publishers — "Agent & access" carries both a permission mode and a
// pending-permission count — so fragments are keyed: each publisher owns exactly its own, and the
// rail joins them with " · " in publish order.
//
// Pure module-level store, deliberately React-free (the hooks that drive it live in
// components/settings/section-summary.tsx), so this logic is unit-testable without a renderer —
// same split as lib/appearance.ts vs the appearance card.

const fragments = new Map<string, Map<string, string>>();
const subscribers = new Set<() => void>();
let version = 0;

/** Bumped on every publish/withdraw; the rail subscribes to this scalar and re-reads each row's
 * summary during render. */
export function summaryVersion(): number {
  return version;
}

export function subscribeToSummaries(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function emit(): void {
  version += 1;
  subscribers.forEach((s) => s());
}

/** Publish (or, with an empty value, withdraw) one fragment of a section's summary. Returns the
 * withdraw function, so a caller that publishes on mount can drop the fragment on unmount —
 * navigating away must never leave a stale value on a rail row. */
export function publishSummary(sectionId: string, key: string, value: string | undefined): () => void {
  let parts = fragments.get(sectionId);
  if (!parts) {
    parts = new Map();
    fragments.set(sectionId, parts);
  }
  if (value) parts.set(key, value);
  else parts.delete(key);
  if (!parts.size) fragments.delete(sectionId);
  emit();

  return () => {
    const live = fragments.get(sectionId);
    if (!live) return;
    if (!live.delete(key)) return; // already withdrawn — don't emit a no-op
    if (!live.size) fragments.delete(sectionId);
    emit();
  };
}

/** One section's joined summary — empty string when nothing has published for it (a plain browser,
 * an older shell, or a card mid-round-trip). The rail renders no second line at all in that case
 * rather than a placeholder. */
export function sectionSummary(sectionId: string): string {
  const parts = fragments.get(sectionId);
  if (!parts?.size) return "";
  return [...parts.values()].filter(Boolean).join(" · ");
}

/** Test seam — drops every fragment and subscriber. Not called by the app. */
export function resetSummaries(): void {
  fragments.clear();
  subscribers.clear();
  version = 0;
}
