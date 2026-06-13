import { execSync } from "node:child_process";
import { platform } from "node:os";

// Open a URL in the user's default browser. No-op when BEACON_NO_OPEN is set (the daemon / CI)
// or when no opener exists. Server/bin ONLY — never import from a client component (it uses
// node:child_process). Replaces the per-bin duplicated opener in bin/plan.ts and bin/beacon.ts.
export function openBrowser(url: string): void {
  if (process.env.BEACON_NO_OPEN) return;
  const opener = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${opener} "${url}"`, { stdio: "ignore" });
  } catch {
    /* no opener available — non-fatal */
  }
}

// Make a presented plan VISIBLE: if no /plan tab is already live for this workspace, open one.
// Goes through the activate route (sets the per-browser cookie + provisions the db); the ?ws param
// pins the tab to THIS repo so a second agent's plan opens its own tab. When a tab IS live it picks
// the new plan up on its own (PlanProvider polls /api/plan), so we don't open a duplicate.
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
  const planPath = encodeURIComponent(`/plan?ws=${wsId}`);
  openBrowser(`${base}/api/workspace/activate?id=${wsId}&redirect=${planPath}`);
}
