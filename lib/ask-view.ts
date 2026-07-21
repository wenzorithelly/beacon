import type { PendingAsk } from "./ask-store";

// Client-safe ask helpers. This module must NOT import any runtime value from ask-store.ts —
// ask-store pulls node:fs/os (via lib/project) and is server-only, so a runtime import of it from a
// "use client" component (ask-modal.tsx) drags those node: builtins into the browser bundle and
// fails the webpack build (bug 2026-07-12). The `import type` above is erased at build time, so this
// file stays free of node: deps and is safe to import as a value from client components.

/** Two mirror snapshots represent the SAME view iff id, questionIndex, and deliveredAt all match.
 *  A multi-question ask keeps `id` constant while `questionIndex`/`deliveredAt` advance in place, so
 *  an id-only comparison would freeze the modal on the first question — it must re-render on the
 *  advance while still skipping the needless re-render when nothing meaningful changed. */
export function sameAskView(a: PendingAsk | null, b: PendingAsk | null): boolean {
  if (a == null || b == null) return a === b;
  return (
    a.id === b.id &&
    (a.questionIndex ?? 0) === (b.questionIndex ?? 0) &&
    (a.deliveredAt ?? null) === (b.deliveredAt ?? null)
  );
}

/** Same, for the whole pending QUEUE (several sessions can be waiting at once). Order matters — the
 *  panel renders the head — so this is a positional compare, not a set compare. */
export function sameAskQueue(a: PendingAsk[], b: PendingAsk[]): boolean {
  return a.length === b.length && a.every((x, i) => sameAskView(x, b[i]));
}
