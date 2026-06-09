import { z } from "zod";
import { eq, notInArray } from "drizzle-orm";
import { db, type DB } from "@/lib/db-drizzle";
import { codeFile, codeFileEdge, syncState } from "@/lib/drizzle/schema";
import { bumpVersion } from "@/lib/ingest";

// Persistence for the file-import graph the watcher rebuilds each tick. Every
// row is introspection-derived (there is no manual code-file editing), so the
// shape is simpler than ingestSnapshot: full-replace files, full-replace edges,
// preserve x/y across re-scans. Circular-edge flagging runs here (not in the
// extractor) because it's a property of the global graph, not of any single file.

export const codeGraphSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().trim().min(1),
        root: z.string().nullish(),
        lang: z.string().nullish(),
        mtimeMs: z.number().nullish(),
        size: z.number().nullish(),
      }),
    )
    .default([]),
  edges: z
    .array(
      z.object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1),
      }),
    )
    .default([]),
});
export type CodeGraphInput = z.input<typeof codeGraphSchema>;

/**
 * Tarjan's SCC, iterative (avoids recursion depth on deep import chains).
 * Returns a Set of "from→to" keys for edges that sit inside a non-trivial SCC
 * — i.e. edges that participate in some import cycle.
 */
export function findCircularEdges(
  nodes: string[],
  edges: { from: string; to: string }[],
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const tarStack: string[] = [];
  const sccOf = new Map<string, number>();
  const sccSizes: number[] = [];
  let index = 0;
  let sccCount = 0;

  type Frame = { v: string; iter: number };
  for (const start of nodes) {
    if (indexOf.has(start)) continue;
    const callStack: Frame[] = [{ v: start, iter: 0 }];
    indexOf.set(start, index);
    lowlink.set(start, index);
    index++;
    tarStack.push(start);
    onStack.add(start);

    while (callStack.length) {
      const top = callStack[callStack.length - 1];
      const succ = adj.get(top.v) ?? [];
      if (top.iter < succ.length) {
        const w = succ[top.iter++];
        if (!indexOf.has(w)) {
          indexOf.set(w, index);
          lowlink.set(w, index);
          index++;
          tarStack.push(w);
          onStack.add(w);
          callStack.push({ v: w, iter: 0 });
        } else if (onStack.has(w)) {
          lowlink.set(top.v, Math.min(lowlink.get(top.v)!, indexOf.get(w)!));
        }
      } else {
        if (lowlink.get(top.v) === indexOf.get(top.v)) {
          let size = 0;
          let w: string;
          do {
            w = tarStack.pop()!;
            onStack.delete(w);
            sccOf.set(w, sccCount);
            size++;
          } while (w !== top.v);
          sccSizes.push(size);
          sccCount++;
        }
        callStack.pop();
        // Propagate lowlink back to caller (the recursive "return" step).
        const caller = callStack[callStack.length - 1];
        if (caller) {
          lowlink.set(
            caller.v,
            Math.min(lowlink.get(caller.v)!, lowlink.get(top.v)!),
          );
        }
      }
    }
  }

  const out = new Set<string>();
  for (const e of edges) {
    const si = sccOf.get(e.from);
    if (si !== undefined && si === sccOf.get(e.to) && sccSizes[si] > 1) {
      out.add(`${e.from}|${e.to}`);
    }
  }
  return out;
}

/**
 * Upsert a code-graph snapshot. Idempotent. Preserves CodeFile.x/y across runs.
 * Edges are full-replaced (the table is small and the PK is (from,to) so a
 * blanket deleteMany + createMany is cheaper than diffing).
 */
export async function ingestCodeGraph(input: unknown, prisma: DB = db) {
  const snap = codeGraphSchema.parse(input);
  const keep = snap.files.map((f) => f.path);
  const keepSet = new Set(keep);

  // Valid edges (drop danglers + self-loops), cycle flags, and per-file degrees —
  // computed once up front so the file upserts below can cache inDegree/outDegree.
  const valid = snap.edges.filter(
    (e) => keepSet.has(e.from) && keepSet.has(e.to) && e.from !== e.to,
  );
  const circular = findCircularEdges(keep, valid);
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of valid) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }

  // Drop files that vanished from this scan. Cascade drops their edges too.
  await prisma.delete(codeFile).where(notInArray(codeFile.path, keep));

  // Upsert present files with metadata + cached degrees. `updatedAt` is @updatedAt,
  // so a no-op update still bumps it — that's how we tell the UI the row was touched.
  for (const f of snap.files) {
    const data = {
      root: f.root ?? null,
      lang: f.lang ?? null,
      mtimeMs: f.mtimeMs ?? null,
      size: f.size ?? null,
      inDegree: inDeg.get(f.path) ?? 0,
      outDegree: outDeg.get(f.path) ?? 0,
    };
    await prisma
      .insert(codeFile)
      .values({ path: f.path, ...data })
      .onConflictDoUpdate({ target: codeFile.path, set: data });
  }

  // Edges: full-replace (small table, PK (from,to) → blanket delete + createMany).
  await prisma.delete(codeFileEdge);
  let circularCount = 0;
  if (valid.length) {
    await prisma.insert(codeFileEdge).values(
      valid.map((e) => {
        const isCircular = circular.has(`${e.from}|${e.to}`);
        if (isCircular) circularCount++;
        return { fromPath: e.from, toPath: e.to, circular: isCircular };
      }),
    );
  }

  const version = await bumpVersion(prisma);
  // Staleness signal: stamp WHEN the code graph last fully synced. bumpVersion just
  // upserted the row, so the update is safe. (Only the code-graph sync sets this — the
  // schema/endpoint ingest in lib/ingest.ts bumps the version but not this field.)
  await prisma.update(syncState).set({ codeGraphSyncedAt: new Date() }).where(eq(syncState.id, "singleton"));
  return {
    files: snap.files.length,
    edges: valid.length,
    circular: circularCount,
    version,
  };
}

// ── Blast radius ───────────────────────────────────────────────────────────

const NODE_CAP = 200; // max transitive nodes returned before we flag `truncated`
const HUB_FLOOR = 3; // a file needs at least this many importers to be a hub at all

export interface BlastNode {
  path: string;
  depth: number;
  lang: string | null;
}

export interface BlastRadiusResult {
  path: string;
  exists: boolean;
  hub: { inDegree: number; outDegree: number; isHub: boolean };
  imports: { to: string; circular: boolean }[]; // 1-hop out
  importedBy: { from: string; circular: boolean }[]; // 1-hop in
  transitive: { upstream: BlastNode[]; downstream: BlastNode[]; truncated: boolean };
}

/**
 * BFS over the import graph from `start`, one direction:
 *   "down" follows INCOMING edges (importers) — "who depends on me", the blast radius.
 *   "up"   follows OUTGOING edges (imports)    — "what I depend on".
 * Stops at `maxDepth` or once NODE_CAP nodes are collected (then `truncated`).
 */
async function bfs(
  prisma: DB,
  start: string,
  maxDepth: number,
  dir: "down" | "up",
): Promise<{ order: { path: string; depth: number }[]; truncated: boolean }> {
  const visited = new Set([start]);
  const order: { path: string; depth: number }[] = [];
  let frontier = [start];
  let truncated = false;
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const neighbors =
      dir === "down"
        ? (
            await prisma.query.codeFileEdge.findMany({
              where: (t, { inArray: inA }) => inA(t.toPath, frontier),
              columns: { fromPath: true },
            })
          ).map((r) => r.fromPath)
        : (
            await prisma.query.codeFileEdge.findMany({
              where: (t, { inArray: inA }) => inA(t.fromPath, frontier),
              columns: { toPath: true },
            })
          ).map((r) => r.toPath);
    const next: string[] = [];
    for (const p of neighbors) {
      if (visited.has(p)) continue;
      visited.add(p);
      order.push({ path: p, depth });
      next.push(p);
      if (order.length >= NODE_CAP) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
    frontier = next;
  }
  return { order, truncated };
}

/**
 * Rich, deterministic blast radius for a file: 1-hop imports/importedBy (unchanged),
 * transitive depth-N reachability both directions, and hub/centrality scoring from the
 * cached degrees. Reuses the existing CodeFileEdge rows — no new tables, no AI.
 */
export async function blastRadius(
  prisma: DB,
  path: string,
  opts: { depth?: number } = {},
): Promise<BlastRadiusResult> {
  const file = await prisma.query.codeFile.findFirst({
    where: (t, { eq }) => eq(t.path, path),
    columns: { inDegree: true, outDegree: true },
  });
  if (!file) {
    return {
      path,
      exists: false,
      hub: { inDegree: 0, outDegree: 0, isHub: false },
      imports: [],
      importedBy: [],
      transitive: { upstream: [], downstream: [], truncated: false },
    };
  }
  const depth = Math.min(Math.max(Math.floor(opts.depth ?? 2), 1), 5);

  const [out1, in1, downBfs, upBfs, allDeg] = await Promise.all([
    prisma.query.codeFileEdge.findMany({
      where: (t, { eq }) => eq(t.fromPath, path),
      columns: { toPath: true, circular: true },
    }),
    prisma.query.codeFileEdge.findMany({
      where: (t, { eq }) => eq(t.toPath, path),
      columns: { fromPath: true, circular: true },
    }),
    bfs(prisma, path, depth, "down"),
    bfs(prisma, path, depth, "up"),
    prisma.query.codeFile.findMany({ columns: { inDegree: true } }),
  ]);

  // Batch-fetch lang for every transitive node.
  const nodePaths = [...new Set([...downBfs.order, ...upBfs.order].map((n) => n.path))];
  const langRows = nodePaths.length
    ? await prisma.query.codeFile.findMany({
        where: (t, { inArray: inA }) => inA(t.path, nodePaths),
        columns: { path: true, lang: true },
      })
    : [];
  const langByPath = new Map(langRows.map((r) => [r.path, r.lang]));
  const withLang = (n: { path: string; depth: number }): BlastNode => ({
    path: n.path,
    depth: n.depth,
    lang: langByPath.get(n.path) ?? null,
  });

  // Hub: inDegree at or above max(floor, 90th-percentile of nonzero inDegrees).
  const nonzero = allDeg.map((f) => f.inDegree).filter((n) => n > 0).sort((a, b) => a - b);
  const p90 = nonzero.length ? nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * 0.9))] : 0;
  const isHub = file.inDegree > 0 && file.inDegree >= Math.max(HUB_FLOOR, p90);

  return {
    path,
    exists: true,
    hub: { inDegree: file.inDegree, outDegree: file.outDegree, isHub },
    imports: out1.map((e) => ({ to: e.toPath, circular: e.circular })),
    importedBy: in1.map((e) => ({ from: e.fromPath, circular: e.circular })),
    transitive: {
      upstream: upBfs.order.map(withLang),
      downstream: downBfs.order.map(withLang),
      truncated: upBfs.truncated || downBfs.truncated,
    },
  };
}
