import { cookies } from "next/headers";
import { BEACON_WS_COOKIE, getWorkspace, runWithWorkspace } from "@/lib/workspaces";

// Pin an RSC page render to the browser's selected workspace (the `beacon_ws` cookie) so
// `db` / `dataDir()` / `repoRoot()` resolve to the dropdown selection rather than the global
// `active` file — which any background agent push or CLI open mutates. Falls back to the
// active workspace when the cookie is absent or stale (a fresh tab, the CLI default).
//
// Server-only: imports next/headers, so it must be called from a Server Component / route.
export async function withBrowserWorkspace<T>(fn: () => Promise<T>): Promise<T> {
  const id = (await cookies()).get(BEACON_WS_COOKIE)?.value;
  return runWithWorkspace(id && getWorkspace(id) ? id : null, fn);
}

// Resolve the workspace a /plan render is pinned to. The `?ws=<id>` URL param (opened by the
// ExitPlanMode hook) wins so the tab is pinned PER-TAB — two concurrent agent plans no longer
// collide on the single shared cookie, and feedback routes to the repo whose agent is waiting.
// Falls back to the cookie selection, then the global active workspace. Returns the resolved id
// (or null) so the caller can hand the SAME id to the client for its fetch headers.
export async function resolvePlanWorkspaceId(wsParam?: string): Promise<string | null> {
  if (wsParam && getWorkspace(wsParam)) return wsParam;
  const cookieId = (await cookies()).get(BEACON_WS_COOKIE)?.value;
  return cookieId && getWorkspace(cookieId) ? cookieId : null;
}
