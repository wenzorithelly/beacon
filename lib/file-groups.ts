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
function adaptiveGroupKeys(paths: string[]): Map<string, string> {
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

/** Trim, strip leading/trailing slashes, drop empties, dedupe — so `['/frontend/', '']`
 *  becomes `['frontend']`. */
function normalizeRoots(roots?: string[]): string[] {
  if (!roots?.length) return [];
  const seen = new Set<string>();
  for (const r of roots) {
    const clean = r.trim().replace(/^\/+|\/+$/g, "");
    if (clean) seen.add(clean);
  }
  return [...seen];
}

/** The longest declared root that contains `path` (path equals the root or sits under it). */
function matchRoot(path: string, roots: string[]): string | null {
  let best: string | null = null;
  for (const r of roots) {
    if ((path === r || path.startsWith(`${r}/`)) && (!best || r.length > best.length)) best = r;
  }
  return best;
}

/** Group a rooted file one level below its root: `frontend` + `components/ui/x.tsx`
 *  → `frontend/components`. A file sitting directly in the root stays at the root. */
function groupUnderRoot(path: string, root: string): string {
  if (path === root || !path.startsWith(`${root}/`)) return root;
  const rest = path.slice(root.length + 1);
  if (!rest.includes("/")) return root; // loose file directly in the root dir
  return `${root}/${rest.slice(0, rest.indexOf("/"))}`;
}

/** File → cluster mapping for the FILES canvas.
 *
 *  When `classificationRoots` are declared (by the agent at beacon-init, stored on
 *  ProjectMeta), each file under a root is grouped ONE level below it (longest-prefix
 *  match) — so a minority `frontend` splits into `frontend/components`, `frontend/app`, …
 *  instead of collapsing into one flat group while the dominant backend splits deeply.
 *  Files outside every root — and the whole board when no roots are declared — keep the
 *  adaptive dominant-split behavior, so single-root repos are unaffected. */
export function buildGroupKeys(paths: string[], classificationRoots?: string[]): Map<string, string> {
  const roots = normalizeRoots(classificationRoots);
  if (!roots.length) return adaptiveGroupKeys(paths);

  const out = new Map<string, string>();
  const unrooted: string[] = [];
  for (const p of paths) {
    const root = matchRoot(p, roots);
    if (root) out.set(p, groupUnderRoot(p, root));
    else unrooted.push(p);
  }
  for (const [p, g] of adaptiveGroupKeys(unrooted)) out.set(p, g);
  return out;
}
