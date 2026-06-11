// Directory grouping for the FILES canvas. Pure (no db, no fs, no React) so the
// adaptive-split rule is unit-testable and shared by anything that needs the same
// file → cluster mapping (regions, anchors, legend, layer tints).

/** Top-level directory a file belongs to; files at the repo root group together. */
export const topDir = (path: string): string =>
  path.includes("/") ? path.slice(0, path.indexOf("/")) : "(root)";

/** Adaptive group keys: top-level directories normally, but any DOMINANT group keeps
 *  splitting one level deeper until no group dominates the board — so a monolith
 *  (backend/app/{services,api,models,…}) maps to its real packages instead of one giant
 *  blob, and a wrapper dir (web/src/…) is descended through rather than stopped on.
 *  Deterministic; depth-capped as a safety rail. */
export function buildGroupKeys(paths: string[]): Map<string, string> {
  const threshold = Math.max(14, paths.length * 0.35);
  const out = new Map<string, string>();
  for (const p of paths) out.set(p, topDir(p));

  for (let depth = 0; depth < 6; depth++) {
    const counts = new Map<string, number>();
    for (const g of out.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
    let split = false;
    for (const [p, g] of out) {
      if ((counts.get(g) ?? 0) <= threshold) continue;
      if (!p.startsWith(`${g}/`)) continue; // "(root)" or the group dir's own loose files
      const rest = p.slice(g.length + 1);
      if (!rest.includes("/")) continue; // file sits directly in the group dir — stays
      out.set(p, `${g}/${rest.slice(0, rest.indexOf("/"))}`);
      split = true;
    }
    if (!split) break;
  }
  return out;
}
