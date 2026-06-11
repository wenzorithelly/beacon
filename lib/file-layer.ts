// Deterministic file → layer classification for the FILES canvas. Pure (no db, no fs) —
// computed client-side from data the canvas already has (paths + import edges), so it needs
// no schema column, no ingest change, and no migration.
//
// Two passes:
//   1. SEED by path/extension — files whose location states their side outright.
//   2. PROPAGATE along the import graph: an unseeded file used (transitively) only by
//      frontend seeds is frontend, only by backend seeds is backend, by both is fullstack,
//      by neither stays null (neutral — rendered without a layer ring).

import { FRONTEND_FILE_RE, type Layer } from "@/lib/layer";

// Server-side languages: their files never run in the browser.
const BACKEND_EXT_RE = /\.(py|go|rb|rs|java|php|ex|exs)$/i;
// Path shapes that are backend regardless of extension: Next.js route handlers
// (app/api/**, pages/api/**, with or without a src/ prefix), migrations, CLI entrypoints,
// and the server instrumentation hook.
const BACKEND_PATH_RE =
  /(^|\/)(app\/api|pages\/api|migrations|bin)\/|(^|\/)instrumentation\.[^/]+$/;

function seedFor(path: string): Layer | null {
  // Backend path shapes win over extension: app/api/x/route.tsx (rare) is still a route.
  if (BACKEND_PATH_RE.test(path)) return "backend";
  if (FRONTEND_FILE_RE.test(path)) return "frontend";
  if (BACKEND_EXT_RE.test(path)) return "backend";
  return null;
}

/** Classify every file: seeds keep their seed; the rest inherit from whichever side(s)
 *  (transitively) import them. `edges` are import edges: `from` imports `to`. */
export function classifyFileLayers(
  paths: string[],
  edges: { from: string; to: string }[],
): Map<string, Layer | null> {
  const out = new Map<string, Layer | null>();
  const imports = new Map<string, string[]>(); // from → [to, …]
  for (const e of edges) {
    const arr = imports.get(e.from);
    if (arr) arr.push(e.to);
    else imports.set(e.from, [e.to]);
  }

  const seeds = new Map<string, Layer>();
  for (const p of paths) {
    const s = seedFor(p);
    out.set(p, s);
    if (s) seeds.set(p, s);
  }

  // Forward BFS from each side's seeds along "imports" edges: everything a frontend seed
  // pulls in is used by the frontend, and likewise for backend. Visited sets make cycles safe.
  const reach = (side: Layer): Set<string> => {
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const [p, s] of seeds) if (s === side) queue.push(p);
    while (queue.length) {
      const cur = queue.pop()!;
      for (const next of imports.get(cur) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return seen;
  };
  const fromFrontend = reach("frontend");
  const fromBackend = reach("backend");

  for (const p of paths) {
    if (out.get(p)) continue; // seeds win
    const fe = fromFrontend.has(p);
    const be = fromBackend.has(p);
    if (fe && be) out.set(p, "fullstack");
    else if (fe) out.set(p, "frontend");
    else if (be) out.set(p, "backend");
  }
  return out;
}
