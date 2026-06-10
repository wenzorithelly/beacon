import type { SourceFile } from "@/intel/extractors/files";

// Deterministic Next.js App Router endpoint extraction — NO AI. Every app/api/**/route.ts
// that exports an HTTP-method handler becomes one endpoint per method. Dynamic segments
// normalize to the {param} style the board (and the plan loop) already uses; route groups
// vanish from the URL just like they do at runtime. `uses` stays empty here — endpoint→table
// links come from the plan/AI layers and partial ingest preserves them.

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export interface RouteEndpoint {
  method: string;
  path: string;
  uses: { table: string; access: string }[];
  /** Source route file — lets the watcher derive `uses` from its import radius. */
  file: string;
}

function urlPath(filePath: string): string | null {
  const m = filePath.match(/(?:^|\/)app\/(.+)\/route\.(?:ts|tsx|js|jsx|mjs)$/);
  if (!m) return null;
  const segments = m[1]
    .split("/")
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))) // route groups don't reach the URL
    .map((s) => {
      const dyn = s.match(/^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/);
      return dyn ? `{${dyn[1]}}` : s;
    });
  if (segments[0] !== "api") return null; // the board maps the API surface, not pages
  return `/${segments.join("/")}`;
}

export function extractNextRoutes(files: SourceFile[]): RouteEndpoint[] {
  const out: RouteEndpoint[] = [];
  for (const f of files) {
    const path = urlPath(f.path);
    if (!path) continue;
    for (const method of METHODS) {
      const re = new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`);
      if (re.test(f.content)) out.push({ method, path, uses: [], file: f.path });
    }
  }
  return out.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}
