import { openBrowser } from "@/lib/plan-open";

// Make a pushed lesson VISIBLE: if no /learn tab is already live for this workspace, open one.
// Mirrors openPlanTabIfNone — goes through the activate route (sets the per-browser cookie +
// provisions the db) with a ?ws param pinning the tab to THIS repo. When a /learn tab IS live it
// picks the (re)pushed lesson up on its own (the page polls /api/lesson), so we open nothing.
export async function openLearnTabIfNone(base: string, wsId: string): Promise<void> {
  const live = await fetch(`${base}/api/lesson/presence`, {
    headers: { "x-beacon-workspace": wsId },
  })
    .then((r) => r.json())
    .then((p) => !!(p as { live?: boolean })?.live)
    .catch(() => false);
  if (live) return;
  const learnPath = encodeURIComponent(`/learn?ws=${wsId}`);
  openBrowser(`${base}/api/workspace/activate?id=${wsId}&redirect=${learnPath}`);
}
