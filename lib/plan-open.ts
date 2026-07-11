import { execSync } from "node:child_process";
import { platform } from "node:os";
import { routeToDesktopIfAttached } from "@/lib/open-review";

// Open a URL in the user's default browser. No-op when BEACON_NO_OPEN is set (the daemon / CI)
// or when no opener exists. Server/bin ONLY (it uses node:child_process). Deliberately NOT
// exported: every trigger goes through openSurface below so desktop-first routing can never be
// bypassed — replaced the per-bin duplicated openers in bin/plan.ts, bin/beacon.ts, lesson-open.
function openBrowser(url: string): void {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no opener available — non-fatal */
  }
}

// THE one decide+navigate seam for EVERY trigger that wants a Beacon surface visible (plans,
// lessons, the `beacon` CLI itself, and whatever comes next). Desktop-first, per the owner's rule
// ("if the app is already opened then we do nothing in the browser"): when beacon-desktop is
// attached — its web view live in ANY workspace, or its deliverer heartbeat fresh for THIS one —
// hand it a nav-intent (lib/open-review.ts owns that contract: desktop-tab / deliverer-presence
// signals + nav-intent.json delivery) instead of popping the OS default browser behind it. Only
// with no desktop anywhere does the browser open, through the activate route (sets the per-browser
// cookie + provisions the db) with `path`'s ?ws pin. New triggers call THIS — never openBrowser
// directly — so they inherit desktop-first routing for free.
export async function openSurface(
  base: string,
  wsId: string,
  path: string,
): Promise<"desktop" | "browser"> {
  if (await routeToDesktopIfAttached(base, wsId, path)) return "desktop";
  openBrowser(`${base}/api/workspace/activate?id=${wsId}&redirect=${encodeURIComponent(path)}`);
  return "browser";
}

// Make a presented plan VISIBLE: if no /plan tab is already live for this workspace, open one via
// openSurface (desktop-first). The ?ws param pins the tab to THIS repo so a second agent's plan
// opens its own tab. When a /plan tab IS live it picks the new plan up on its own (PlanProvider
// polls /api/plan), so we don't open a duplicate.
//
// The ExitPlanMode hook always did this; the MCP present/propose paths only ACTIVATED the
// workspace (which silently switches an already-open tab but opens nothing) — so a plan presented
// outside plan mode stayed invisible until the user opened Beacon by hand. This closes that gap.
export async function openPlanTabIfNone(base: string, wsId: string): Promise<void> {
  const live = await fetch(`${base}/api/plan/presence`, {
    headers: { "x-beacon-workspace": wsId },
  })
    .then((r) => r.json())
    .then((p) => !!(p as { live?: boolean })?.live)
    .catch(() => false);
  if (live) return;
  await openSurface(base, wsId, `/plan?ws=${wsId}`);
}
