import { openSurface } from "@/lib/plan-open";

// Make a pushed lesson VISIBLE: if no /learn tab is already live for this workspace, open one via
// the shared openSurface seam (lib/plan-open.ts) — desktop-first when beacon-desktop is attached,
// browser otherwise — with a ?ws param pinning the tab to THIS repo. When a /learn tab IS live it
// picks the (re)pushed lesson up on its own (the page polls /api/lesson), so we open nothing.
export async function openLearnTabIfNone(base: string, wsId: string): Promise<void> {
  const live = await fetch(`${base}/api/lesson/presence`, {
    headers: { "x-beacon-workspace": wsId },
  })
    .then((r) => r.json())
    .then((p) => !!(p as { live?: boolean })?.live)
    .catch(() => false);
  if (live) return;
  await openSurface(base, wsId, `/learn?ws=${wsId}`);
}
