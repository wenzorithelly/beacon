// Pure symbol-graph query engine — no db import (unit-testable with a hand-built graph). The
// route (app/api/code-graph/query/route.ts) loads the four tables and calls buildGraph, then one
// of the verbs below. Every verb returns `{ text, ...structured }` — `text` is what the CLI prints
// verbatim, so it must always be a complete, human-readable answer on its own.

export type GraphNode = {
  id: string;
  label: string; // qualifiedName (symbols) or file path (files)
  kind: string; // function | class | method | type | const | "file"
  path: string;
  line: number | null;
  exported?: boolean;
};
// relation: calls | extends | implements | references | imports | contains | member
// confidence: EXTRACTED | INFERRED. line: call/heritage site — lives in the FROM node's file.
export type GraphEdge = { from: string; to: string; relation: string; confidence: string; line: number | null };
export type Graph = {
  nodes: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
  degree: (id: string) => number;
};

export interface BuildGraphInput {
  symbols: {
    id: string; path: string; name: string; qualifiedName: string; kind: string;
    line: number; endLine: number; exported: boolean; parentId: string | null;
  }[];
  symbolEdges: { fromId: string; toId: string; relation: string; confidence: string; line: number | null }[];
  files: { path: string }[];
  fileEdges: { fromPath: string; toPath: string }[];
}

function pushEdge(map: Map<string, GraphEdge[]>, key: string, e: GraphEdge) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(e);
}

/**
 * Assembles the queryable graph: file nodes + symbol nodes, plus three edge kinds the raw tables
 * don't carry directly — `contains` (file → its symbols), `member` (class → method, from
 * `parentId` — needed because a caller of a METHOD never points at the CLASS id, so affectedBy
 * seeds through this), and `imports` (the existing file-level graph, folded in so a query can walk
 * from a symbol out to file-level blast radius).
 */
export function buildGraph(input: BuildGraphInput): Graph {
  const nodes = new Map<string, GraphNode>();
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  const addEdge = (e: GraphEdge) => {
    pushEdge(out, e.from, e);
    pushEdge(inn, e.to, e);
  };

  for (const f of input.files) nodes.set(f.path, { id: f.path, label: f.path, kind: "file", path: f.path, line: null });
  for (const s of input.symbols) {
    nodes.set(s.id, { id: s.id, label: s.qualifiedName, kind: s.kind, path: s.path, line: s.line, exported: s.exported });
  }
  for (const s of input.symbols) {
    addEdge({ from: s.path, to: s.id, relation: "contains", confidence: "EXTRACTED", line: null });
    if (s.parentId) addEdge({ from: s.parentId, to: s.id, relation: "member", confidence: "EXTRACTED", line: null });
  }
  for (const e of input.fileEdges) addEdge({ from: e.fromPath, to: e.toPath, relation: "imports", confidence: "EXTRACTED", line: null });
  for (const e of input.symbolEdges) addEdge({ from: e.fromId, to: e.toId, relation: e.relation, confidence: e.confidence, line: e.line ?? null });

  const degree = (id: string) => (out.get(id)?.length ?? 0) + (inn.get(id)?.length ?? 0);
  return { nodes, out, in: inn, degree };
}

// ── shared render/lookup helpers ────────────────────────────────────────────────────────────
const locStr = (path: string, line: number | null) => (line != null ? `${path}:L${line}` : path);
// An edge's "location" is always its FROM node's file — that's where a call/reference/import
// site physically lives, in both directions of a walk.
const edgeLoc = (g: Graph, e: GraphEdge) => locStr(g.nodes.get(e.from)?.path ?? e.from, e.line);
const renderNodeLine = (n: GraphNode) => `NODE ${n.label} [kind=${n.kind} src=${locStr(n.path, n.line)}]`;
const allEdges = (g: Graph) => [...g.out.values()].flat();

function graphSizes(g: Graph) {
  let symbols = 0;
  let files = 0;
  for (const n of g.nodes.values()) (n.kind === "file" ? files++ : symbols++);
  return { symbols, files, edges: allEdges(g).length };
}

export function graphStats(g: Graph) {
  const s = graphSizes(g);
  return { ...s, text: `${s.symbols} symbols · ${s.edges} edges · ${s.files} files` };
}

// ── symbol resolution (shared by explain / affected / path) ────────────────────────────────
type Resolved = { node: GraphNode } | { ambiguous: string[]; text: string } | { notFound: true; text: string };
const lastSeg = (label: string) => label.split(".").pop() ?? label;

/** Exact (case-sensitive, then case-insensitive) → unique prefix → unique substring, matched
 *  against qualifiedName (label) or bare name (its last segment). Multiple hits refuse ONLY when
 *  they span different files — same-file duplicates (e.g. overloads) pick the earliest line. */
function resolveSymbol(g: Graph, name: string): Resolved {
  const ids = [...g.nodes.keys()];
  const find = (pred: (n: GraphNode) => boolean) => ids.filter((id) => pred(g.nodes.get(id)!));

  let matches = find((n) => n.label === name || lastSeg(n.label) === name);
  const lower = name.toLowerCase();
  if (!matches.length) matches = find((n) => n.label.toLowerCase() === lower || lastSeg(n.label).toLowerCase() === lower);
  if (!matches.length) matches = find((n) => n.label.toLowerCase().startsWith(lower) || lastSeg(n.label).toLowerCase().startsWith(lower));
  if (!matches.length) matches = find((n) => n.label.toLowerCase().includes(lower) || lastSeg(n.label).toLowerCase().includes(lower));
  if (!matches.length) return { notFound: true, text: `No symbol named "${name}" found. Try \`beacon query "${name}"\` to search broadly.` };
  if (matches.length > 1) {
    const paths = new Set(matches.map((id) => g.nodes.get(id)!.path));
    if (paths.size > 1) {
      const list = matches.map((id) => {
        const n = g.nodes.get(id)!;
        return `${n.label} (${n.path}:L${n.line})`;
      });
      return { ambiguous: list, text: `"${name}" is ambiguous — it matches symbols in multiple files:\n${list.map((l) => `  ${l}`).join("\n")}` };
    }
    matches.sort((a, b) => (g.nodes.get(a)!.line ?? 0) - (g.nodes.get(b)!.line ?? 0));
  }
  return { node: g.nodes.get(matches[0])! };
}

// ── queryGraph ───────────────────────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "does", "do", "how",
  "what", "where", "which", "when", "why", "with", "into", "from", "this", "that", "get", "gets",
]);

function tokenize(question: string): string[] {
  const words = question.toLowerCase().match(/\w+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

/** camelCase/snake_case/dotted → lowercase word parts, so "getUserById" matches term "user". */
function splitWords(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]/g, " ").split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
}

interface NodeInfo { label: string; lastSeg: string; parts: Set<string>; path: string }

function matchTier(m: NodeInfo, term: string): number {
  if (m.label === term || m.lastSeg === term || m.parts.has(term)) return 1000;
  if (m.label.startsWith(term) || m.lastSeg.startsWith(term) || [...m.parts].some((p) => p.startsWith(term))) return 100;
  if (m.label.includes(term)) return 1;
  if (m.path.includes(term)) return 0.5;
  return 0;
}

function scoreNodes(g: Graph, terms: string[]) {
  const ids = [...g.nodes.keys()];
  const info = new Map<string, NodeInfo>(
    ids.map((id) => {
      const n = g.nodes.get(id)!;
      const label = n.label.toLowerCase();
      const ls = lastSeg(label);
      return [id, { label, lastSeg: ls, parts: new Set([...splitWords(n.label), ...splitWords(ls)]), path: n.path.toLowerCase() }];
    }),
  );
  const df = new Map<string, number>(
    terms.map((t) => [t, ids.reduce((c, id) => c + (info.get(id)!.label.includes(t) || info.get(id)!.path.includes(t) ? 1 : 0), 0)]),
  );
  const N = ids.length;
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)));

  const scores = new Map<string, number>();
  const matchedTerms = new Map<string, Set<string>>();
  for (const id of ids) {
    const m = info.get(id)!;
    let total = 0;
    const matched = new Set<string>();
    for (const term of terms) {
      const tier = matchTier(m, term);
      if (tier > 0) {
        matched.add(term);
        total += tier * idf(term);
      }
    }
    const coverage = terms.length ? matched.size / terms.length : 0;
    scores.set(id, total * coverage * coverage);
    matchedTerms.set(id, matched);
  }
  return { scores, matchedTerms };
}

function selectSeeds(scores: Map<string, number>, matchedTerms: Map<string, Set<string>>, terms: string[]): string[] {
  const ranked = [...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const threshold = ranked[0][1] * 0.8;
  const seeds = ranked.filter(([, s]) => s >= threshold).slice(0, 3).map(([id]) => id);
  const seedSet = new Set(seeds);
  for (const term of terms) {
    if (seeds.some((id) => matchedTerms.get(id)?.has(term))) continue;
    const best = ranked.find(([id]) => matchedTerms.get(id)?.has(term));
    if (best && !seedSet.has(best[0])) {
      seeds.push(best[0]);
      seedSet.add(best[0]);
    }
  }
  return seeds;
}

function hubThreshold(g: Graph): number {
  const degrees = [...g.nodes.keys()].map((id) => g.degree(id)).filter((d) => d > 0).sort((a, b) => a - b);
  const p99 = degrees.length ? degrees[Math.min(degrees.length - 1, Math.floor(degrees.length * 0.99))] : 0;
  return Math.max(50, p99);
}

function neighborsOf(g: Graph, id: string): string[] {
  const outs = (g.out.get(id) ?? []).map((e) => e.to);
  const ins = (g.in.get(id) ?? []).map((e) => e.from);
  return [...outs, ...ins].filter((n) => g.nodes.has(n));
}

/** BFS (default) or depth-limited DFS from every seed, both directions, never expanding THROUGH
 *  a hub node (degree ≥ p99 floor 50) unless that hub is itself a seed. */
function traverse(g: Graph, seeds: string[], depth: number, mode: "bfs" | "dfs") {
  const hubT = hubThreshold(g);
  const seedSet = new Set(seeds);
  const isBlocked = (id: string) => g.degree(id) >= hubT && !seedSet.has(id);
  const visited = new Set(seeds);
  const order: string[] = [];

  if (mode === "dfs") {
    const stack: { id: string; d: number }[] = seeds.map((id) => ({ id, d: 0 })).reverse();
    while (stack.length) {
      const { id, d } = stack.pop()!;
      if (d >= depth || isBlocked(id)) continue;
      for (const nb of neighborsOf(g, id)) {
        if (visited.has(nb)) continue;
        visited.add(nb);
        order.push(nb);
        stack.push({ id: nb, d: d + 1 });
      }
    }
  } else {
    let frontier = seeds.map((id) => ({ id, d: 0 }));
    while (frontier.length) {
      const next: { id: string; d: number }[] = [];
      for (const { id, d } of frontier) {
        if (d >= depth || isBlocked(id)) continue;
        for (const nb of neighborsOf(g, id)) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          order.push(nb);
          next.push({ id: nb, d: d + 1 });
        }
      }
      frontier = next;
    }
  }
  return { visited, order };
}

function renderEdgeLine(g: Graph, e: GraphEdge): string {
  const from = g.nodes.get(e.from)?.label ?? e.from;
  const to = g.nodes.get(e.to)?.label ?? e.to;
  const tail = e.line != null ? ` at=${edgeLoc(g, e)}` : "";
  return `EDGE ${from} --${e.relation} [${e.confidence}]--> ${to}${tail}`;
}

/** Cuts at a line boundary once ~budget*3 chars are used. Seed NODE lines are NEVER dropped —
 *  they're the reason the rest of the subgraph exists. */
function applyBudget(header: string, nodeLines: string[], seedCount: number, edgeLines: string[], budget: number) {
  const charBudget = budget * 3;
  let used = header.length + 1;
  for (let i = 0; i < seedCount; i++) used += nodeLines[i].length + 1;

  let shownNodes = seedCount;
  for (; shownNodes < nodeLines.length; shownNodes++) {
    const len = nodeLines[shownNodes].length + 1;
    if (used + len > charBudget) break;
    used += len;
  }
  const nodesTruncated = shownNodes < nodeLines.length;

  let shownEdges = 0;
  if (!nodesTruncated) {
    for (; shownEdges < edgeLines.length; shownEdges++) {
      const len = edgeLines[shownEdges].length + 1;
      if (used + len > charBudget) break;
      used += len;
    }
  }
  const truncated = nodesTruncated || shownEdges < edgeLines.length;
  const lines = [header, ...nodeLines.slice(0, shownNodes), ...edgeLines.slice(0, shownEdges)];
  if (truncated) lines.push(`… truncated: ${shownNodes} of ${nodeLines.length} nodes shown (~${budget} tokens). Raise --budget or narrow the question.`);
  return { text: lines.join("\n"), truncated };
}

export function queryGraph(g: Graph, question: string, opts: { mode?: "bfs" | "dfs"; depth?: number; budget?: number } = {}) {
  const mode = opts.mode ?? "bfs";
  const depth = opts.depth ?? 2;
  const budget = opts.budget ?? 2000;
  const terms = tokenize(question);
  const { scores, matchedTerms } = scoreNodes(g, terms);
  const seeds = selectSeeds(scores, matchedTerms, terms);
  if (!seeds.length) return { text: `No symbol matches: [${terms.join(", ")}]. Try \`beacon explain <name>\` with a name from the code.` };

  const { visited, order } = traverse(g, seeds, depth, mode);
  const nodeIds = [...seeds, ...order];
  const edges = allEdges(g).filter((e) => visited.has(e.from) && visited.has(e.to));

  const stats = graphSizes(g);
  const seedLabels = seeds.map((id) => g.nodes.get(id)!.label);
  const header = `Graph: ${stats.symbols} symbols · ${stats.edges} edges | Traversal: ${mode.toUpperCase()} depth=${depth} | Start: [${seedLabels.join(", ")}] | ${nodeIds.length} nodes found`;

  const nodeLines = nodeIds.map((id) => renderNodeLine(g.nodes.get(id)!));
  const edgeLines = edges.map((e) => renderEdgeLine(g, e));
  const { text, truncated } = applyBudget(header, nodeLines, seeds.length, edgeLines, budget);
  return { text, nodes: nodeIds, edgeCount: edges.length, seeds: seedLabels, truncated };
}

// ── explainNode ──────────────────────────────────────────────────────────────────────────────
function renderNeighborList(g: Graph, edges: GraphEdge[], dir: "in" | "out"): string[] {
  const arrow = dir === "in" ? "<--" : "-->";
  const neighborId = (e: GraphEdge) => (dir === "in" ? e.from : e.to);
  const cap = 20;
  const shown = edges.slice(0, cap).map((e) => {
    const n = g.nodes.get(neighborId(e));
    return `${arrow} ${n?.label ?? neighborId(e)} [${e.relation}] [${e.confidence}] ${edgeLoc(g, e)}`;
  });
  if (edges.length > cap) shown.push(`… and ${edges.length - cap} more`);
  return shown;
}

function groupedByFile(g: Graph, inEdges: GraphEdge[], outEdges: GraphEdge[]): string[] {
  const counts = new Map<string, number>();
  const bump = (p: string) => counts.set(p, (counts.get(p) ?? 0) + 1);
  for (const e of inEdges) bump(g.nodes.get(e.from)?.path ?? e.from);
  for (const e of outEdges) bump(g.nodes.get(e.to)?.path ?? e.to);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p, c]) => `  ${p} (${c})`);
}

export function explainNode(g: Graph, name: string) {
  const resolved = resolveSymbol(g, name);
  if (!("node" in resolved)) return resolved;
  const node = resolved.node;
  const inEdges = [...(g.in.get(node.id) ?? [])].sort((a, b) => g.degree(b.from) - g.degree(a.from));
  const outEdges = [...(g.out.get(node.id) ?? [])].sort((a, b) => g.degree(b.to) - g.degree(a.to));
  const lines = [
    renderNodeLine(node),
    `Degree: in ${inEdges.length} · out ${outEdges.length}`,
    "",
    ...renderNeighborList(g, inEdges, "in"),
    "",
    ...renderNeighborList(g, outEdges, "out"),
    "",
    "Grouped by file:",
    ...groupedByFile(g, inEdges, outEdges),
  ];
  return { text: lines.join("\n"), node: node.id, in: inEdges.length, out: outEdges.length };
}

// ── affectedBy ───────────────────────────────────────────────────────────────────────────────
// Not `contains`: a symbol's own file is where it lives, not something its change reaches — walking
// it put "agents/session-store.ts [contains]" at depth 1 of every answer (e2e, 2026-09-07).
const AFFECTED_RELATIONS = new Set(["calls", "extends", "implements", "references", "imports"]);

export function affectedBy(g: Graph, name: string, opts: { depth?: number } = {}) {
  const depth = opts.depth ?? 2;
  const resolved = resolveSymbol(g, name);
  if (!("node" in resolved)) return resolved;
  const node = resolved.node;

  // A caller of a METHOD never points at its CLASS id — seed with the node's direct members
  // too (via the synthetic `member` edges from buildGraph) so a class-level query still finds them.
  const memberIds = (g.out.get(node.id) ?? []).filter((e) => e.relation === "member").map((e) => e.to);
  const seeds = [node.id, ...memberIds];
  const visited = new Set(seeds);
  const hits = new Map<string, { relation: string; line: number | null; depth: number }>();

  let frontier = seeds.map((id) => ({ id, d: 0 }));
  while (frontier.length) {
    const next: { id: string; d: number }[] = [];
    for (const { id, d } of frontier) {
      if (d >= depth) continue;
      for (const e of g.in.get(id) ?? []) {
        if (!AFFECTED_RELATIONS.has(e.relation) || visited.has(e.from)) continue;
        visited.add(e.from);
        hits.set(e.from, { relation: e.relation, line: e.line, depth: d + 1 });
        next.push({ id: e.from, d: d + 1 });
      }
    }
    frontier = next;
  }

  const byDepth = new Map<number, string[]>();
  for (const [id, info] of hits) {
    const n = g.nodes.get(id);
    const line = `- ${n?.label ?? id} [${info.relation}] ${locStr(n?.path ?? "", info.line)}`;
    (byDepth.get(info.depth) ?? byDepth.set(info.depth, []).get(info.depth)!).push(line);
  }

  const lines = [`Affected by ${node.label} (depth ${depth}):`];
  for (let d = 1; d <= depth; d++) {
    const group = byDepth.get(d);
    if (!group?.length) continue;
    lines.push("", `depth ${d}:`, ...group);
  }
  if (hits.size === 0) lines.push("", "(nothing found)");
  return { text: lines.join("\n"), node: node.id, hits: hits.size };
}

// ── shortestPath ─────────────────────────────────────────────────────────────────────────────
export function shortestPath(g: Graph, from: string, to: string, opts: { undirected?: boolean } = {}) {
  const undirected = opts.undirected ?? false;
  const rf = resolveSymbol(g, from);
  if (!("node" in rf)) return rf;
  const rt = resolveSymbol(g, to);
  if (!("node" in rt)) return rt;
  const src = rf.node.id;
  const dst = rt.node.id;
  if (src === dst) return { text: `${rf.node.label} is itself.`, path: [src] };

  const prev = new Map<string, GraphEdge>();
  const visited = new Set([src]);
  let frontier = [src];
  while (frontier.length && !visited.has(dst)) {
    const next: string[] = [];
    for (const id of frontier) {
      const outs = g.out.get(id) ?? [];
      // Undirected also walks incoming edges, backwards — the edge shown is the real one, we
      // just traverse it the other way, so direction in the rendered line can read "reversed".
      const candidates = undirected ? [...outs, ...(g.in.get(id) ?? []).map((e) => ({ ...e, from: e.to, to: e.from }))] : outs;
      for (const e of candidates) {
        if (visited.has(e.to)) continue;
        visited.add(e.to);
        prev.set(e.to, e);
        next.push(e.to);
      }
    }
    frontier = next;
  }

  if (!visited.has(dst)) {
    return undirected
      ? { text: `No path from ${rf.node.label} to ${rt.node.label}.`, path: [] }
      : { text: `No directed path from ${rf.node.label} to ${rt.node.label}. Re-run with --undirected.`, path: [] };
  }

  const rev: GraphEdge[] = [];
  for (let cur = dst; cur !== src; ) {
    const e = prev.get(cur)!;
    rev.push(e);
    cur = e.from;
  }
  const path = rev.reverse();
  const lines = path.map((e) => `${g.nodes.get(e.from)?.label ?? e.from} --${e.relation} [${e.confidence}]--> ${g.nodes.get(e.to)?.label ?? e.to}`);
  return { text: lines.join("\n"), path: [src, ...path.map((e) => e.to)] };
}
