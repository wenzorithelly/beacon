"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import "@xyflow/react/dist/style.css";
import { Pencil, X, FileCode2 } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { CanvasTabs } from "@/components/graph/canvas-tabs";
import { untestedFiles } from "@/lib/test-coverage";
import { type TouchedMap } from "@/lib/touched-files";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";
import { GroupRegions } from "@/components/graph/group-regions";
import { cn } from "@/lib/utils";

// Files view: the import graph of the repo. One node per source file, one edge
// per static/dynamic import. Circular edges (precomputed at ingest via Tarjan's
// SCC) are styled differently so cycles stand out.
//
// Layout: synchronous d3-force simulation — the same family of physics that
// powers Obsidian's graph view — with DIRECTORY GRAVITY: every top-level folder
// gets an anchor point and its files are pulled toward it, so the organic shape
// settles into one cluster per folder (wrapped in a labeled, color-tinted region)
// instead of one undifferentiated blob. Seeds are deterministic (hashed from the
// path), so the same repo gets the same picture on every load.

export interface FileGraphFile {
  path: string;
  x: number;
  y: number;
  lang?: string | null;
  inDegree?: number;
  outDegree?: number;
}
export interface FileGraphEdge {
  from: string;
  to: string;
  circular: boolean;
}

// Per-language accent (the small dot on each node). Detected by file extension at
// ingest; keeps the canvas readable at a glance in polyglot repos. Unknown → grey.
const LANG_COLORS: Record<string, string> = {
  ts: "#3178c6",
  js: "#f7df1e",
  py: "#3776ab",
  go: "#00add8",
  rs: "#dea584",
  swift: "#f05138",
  java: "#b07219",
  ruby: "#cc342d",
  kotlin: "#a97bff",
  csharp: "#178600",
  php: "#4f5d95",
  cpp: "#f34b7d",
  c: "#555555",
};
function langColor(lang?: string | null): string {
  return (lang && LANG_COLORS[lang]) || "#9ca3af";
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  pinned: boolean;
  radius: number;
}

// Approximate the rendered width of a label (text + padding + border) so the
// collision force matches the actual node card, not a circle around its center.
// 6px/char is a reasonable estimate for the 10px font we render.
function collisionRadiusFor(label: string): number {
  const widthHalf = (label.length * 6 + 24) / 2;
  return Math.max(34, widthHalf + 16); // +16 = real breathing room between labels
}

// Deterministic seed positions: hash the path into a stable pseudo-random spot. Same
// repo → same starting state → the simulation settles into the same shape every load.
function seedFor(path: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) h = ((h ^ path.charCodeAt(i)) * 16777619) >>> 0;
  const a = (h % 10007) / 10007;
  const b = ((h >>> 13) % 10007) / 10007;
  return { x: (a - 0.5) * 900, y: (b - 0.5) * 900 };
}

/** Top-level directory a file belongs to; files at the repo root group together. */
export const filesGroupKey = (path: string): string =>
  path.includes("/") ? path.slice(0, path.indexOf("/")) : "(root)";

// Anchor point per directory: biggest folders first, on a wide grid scaled so neighbouring
// clusters have room to breathe. Deterministic (sorted by size desc, then name).
function dirAnchors(files: FileGraphFile[]): Map<string, { x: number; y: number }> {
  const counts = new Map<string, number>();
  for (const f of files) {
    const d = filesGroupKey(f.path);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const dirs = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cols = Math.max(1, Math.ceil(Math.sqrt(dirs.length * 2.5))); // wide grid (~2:1)
  const SPACING_X = 1250;
  const SPACING_Y = 950;
  const anchors = new Map<string, { x: number; y: number }>();
  dirs.forEach(([d], i) => {
    anchors.set(d, { x: (i % cols) * SPACING_X, y: Math.floor(i / cols) * SPACING_Y });
  });
  return anchors;
}

function runForceLayout(
  files: FileGraphFile[],
  edges: FileGraphEdge[],
): Map<string, { x: number; y: number }> {
  const anchors = dirAnchors(files);
  const anchorOf = (path: string) => anchors.get(filesGroupKey(path))!;
  const simNodes: SimNode[] = files.map((f) => {
    const label = f.path.includes("/") ? f.path.split("/").pop()! : f.path;
    const seed = seedFor(f.path);
    const a = anchorOf(f.path);
    return {
      id: f.path,
      // Seed near the directory's anchor so the cluster forms there immediately.
      x: a.x + seed.x * 0.4,
      y: a.y + seed.y * 0.4,
      pinned: false,
      radius: collisionRadiusFor(label),
    };
  });

  const simLinks = edges
    .filter((e) => e.from !== e.to)
    .map((e) => ({ source: e.from, target: e.to }));

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((n) => n.id)
        .distance(170)
        // Weak enough that a cross-directory import can't drag a file out of its cluster.
        .strength(0.15),
    )
    // Stronger repulsion than before — the clogged look came from labels packed so
    // tight the edges between them read as one solid web.
    .force("charge", forceManyBody<SimNode>().strength(-520).distanceMax(900))
    // Collision — per-node radius matches the actual label width so wide
    // filenames like `endpoint-reconcile.test.ts` don't visually overlap.
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => d.radius).strength(1),
    )
    // Directory gravity: every file is pulled toward its folder's anchor, so the
    // organic shape resolves into one labeled cluster per folder.
    .force("clusterX", forceX<SimNode>((d) => anchorOf(d.id).x).strength(0.16))
    .force("clusterY", forceY<SimNode>((d) => anchorOf(d.id).y).strength(0.18))
    .stop();

  // Synchronous: tick to convergence. ~500 ticks for a few hundred nodes is
  // plenty for the simulation to settle (alpha decays to ~0 by then).
  for (let i = 0; i < 500; i++) sim.tick();

  const out = new Map<string, { x: number; y: number }>();
  for (const n of simNodes) {
    out.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }
  return out;
}

interface FileNodeData {
  label: string;
  tooltip: string;
  untested?: boolean;
  // Hub scoring (deterministic, cached at ingest) — high-inDegree files render bigger.
  inDegree?: number;
  lang?: string | null;
  // Touched-Files overlay (driven by the PostToolUse hook via the touched store).
  touched?: boolean;
  count?: number; // edits this session
  recency?: number; // 0..1, newest edit = 1 — drives glow intensity (recency heat)
  isNewest?: boolean; // the single most-recently edited file → one-shot pulse
}

function FileNode({ data }: { data: FileNodeData }) {
  // Compact: filename only. Full path is in the title tooltip — hover reveals
  // it without bloating every node card. The two Handles are required for React
  // Flow to render import edges (error #008 otherwise); styled invisible.
  //
  // Encodings stack so signals are spottable at a glance AND never color-alone
  // (the tooltip + icons/badges carry the meaning for colorblind readers):
  //   • untested → amber border + corner dot
  //   • touched  → teal border + glow whose intensity scales with recency, an
  //     edit-count badge, and a one-shot pulse on the most recent edit.
  const touched = !!data.touched;
  const recency = data.recency ?? 0;
  const inDeg = data.inDegree ?? 0;
  // Hub sizing: high-blast-radius files (imported by many) render bigger so they're
  // spottable without reading every label. Up to +7px over the 10px base; capped so a
  // mega-hub doesn't dwarf the canvas. Edited files keep their (usually larger) size.
  const hubSize = 10 + Math.min(inDeg, 20) * 0.35;
  const fontSize = touched ? Math.max(13 + recency * 4, hubSize) : hubSize;
  const style = {
    fontSize: `${fontSize}px`,
    ...(touched
      ? {
          boxShadow: `0 0 ${6 + Math.round(recency * 12)}px ${1 + Math.round(recency * 3)}px rgba(45,212,191,${(0.25 + recency * 0.5).toFixed(2)})`,
          zIndex: 10,
        }
      : {}),
  };
  const hubNote = inDeg > 0 ? ` · imported by ${inDeg}` : "";
  const title = touched
    ? `${data.tooltip} · edited ${data.count ?? 0}× this session${hubNote}`
    : data.untested
      ? `${data.tooltip} · no test imports this file${hubNote}`
      : `${data.tooltip}${hubNote}`;
  return (
    <div
      title={title}
      style={style}
      className={cn(
        "relative rounded-md border bg-card/85 px-2 py-0.5 text-[10px] font-medium backdrop-blur transition-[font-size,box-shadow,border-color] duration-300",
        touched
          ? "border-teal-300/80 px-2.5 py-1 font-semibold text-foreground"
          : data.untested
            ? "border-amber-400/60 text-foreground/85"
            : "border-white/10 text-foreground/85",
        data.isNewest && "animate-touch-pulse",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-0 !w-0 !min-w-0 !border-0 !bg-transparent"
      />
      {data.untested && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 size-1.5 rounded-full bg-amber-400 ring-2 ring-background"
        />
      )}
      {touched && (data.count ?? 0) > 0 && (
        <span
          aria-hidden
          className="absolute -left-1.5 -top-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-teal-400 px-0.5 text-[7px] font-bold text-background ring-1 ring-background"
        >
          {data.count}
        </span>
      )}
      {data.lang && (
        <span
          aria-hidden
          title={data.lang}
          className="absolute -bottom-1 -right-1 size-1.5 rounded-full ring-1 ring-background"
          style={{ backgroundColor: langColor(data.lang) }}
        />
      )}
      {data.label}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!h-0 !w-0 !min-w-0 !border-0 !bg-transparent"
      />
    </div>
  );
}

const nodeTypes = { file: FileNode };

export function FilesMapClient({
  files,
  edges: edgePayload,
  touched,
}: {
  files: FileGraphFile[];
  edges: FileGraphEdge[];
  touched?: TouchedMap;
}) {
  // Run the simulation every load — it's deterministic (seeded from paths), so the picture
  // is stable across reloads, and layout improvements reach existing boards instead of being
  // frozen by stored positions from an older algorithm. Drags still work within a session.
  const positions = useMemo(() => runForceLayout(files, edgePayload), [files, edgePayload]);

  // Test-Coverage Flags: files no test file imports (deterministic, from the import edges).
  const untested = useMemo(
    () => untestedFiles(files.map((f) => f.path), edgePayload),
    [files, edgePayload],
  );

  // Touched-Files overlay: per-file edit count + recency (0..1, newest = 1) + the single newest.
  const touchedInfo = useMemo(() => {
    const m = new Map<string, { count: number; recency: number; isNewest: boolean }>();
    const entries = Object.entries(touched ?? {});
    if (!entries.length) return m;
    const ats = entries.map(([, e]) => e.lastAt);
    const max = Math.max(...ats);
    const min = Math.min(...ats);
    const span = max - min || 1;
    let newest = entries[0][0];
    let newestAt = entries[0][1].lastAt;
    for (const [p, e] of entries) if (e.lastAt >= newestAt) ((newest = p), (newestAt = e.lastAt));
    for (const [p, e] of entries) m.set(p, { count: e.count, recency: (e.lastAt - min) / span, isNewest: p === newest });
    return m;
  }, [touched]);
  const hasTouched = touchedInfo.size > 0;
  // Readable summary list of edited files (newest first) for the side panel — clicking one
  // selects + pans to it, so you don't have to find it in the dense graph.
  const editedList = useMemo(
    () =>
      Array.from(touchedInfo.entries())
        .map(([path, v]) => ({
          path,
          label: path.slice(path.lastIndexOf("/") + 1),
          count: v.count,
          recency: v.recency,
        }))
        .sort((a, b) => b.recency - a.recency),
    [touchedInfo],
  );

  const initialNodes = useMemo<Node[]>(() => {
    return files.map((f) => {
      const pos = positions.get(f.path) ?? { x: f.x, y: f.y };
      const slash = f.path.lastIndexOf("/");
      const label = slash >= 0 ? f.path.slice(slash + 1) : f.path;
      const ti = touchedInfo.get(f.path);
      return {
        id: f.path,
        type: "file",
        position: pos,
        data: {
          label,
          tooltip: f.path,
          untested: untested.has(f.path),
          inDegree: f.inDegree ?? 0,
          lang: f.lang ?? null,
          touched: !!ti,
          count: ti?.count ?? 0,
          recency: ti?.recency ?? 0,
          isNewest: ti?.isNewest ?? false,
        },
      };
    });
  }, [files, positions, untested, touchedInfo]);

  const initialEdges = useMemo<Edge[]>(
    () =>
      edgePayload.map((e) => ({
        id: `${e.from}|${e.to}`,
        source: e.from,
        target: e.to,
        // Straight lines read like Obsidian's mental map; bezier curves get
        // noisy at this density. Arrowheads dropped for the same reason —
        // connectivity matters more than direction at a glance.
        type: "straight",
        // WHISPER-faint by default — the organic web stays visible as texture, but it can't
        // clog the labels anymore. Hover/select a file and its edges come up to full strength.
        style: e.circular
          ? { stroke: "#f87171", strokeDasharray: "5 3", strokeWidth: 1.5, opacity: 0.5 }
          : { stroke: "#a1a1aa", strokeWidth: 1, opacity: 0.13 },
      })),
    [edgePayload],
  );

  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Hovering a file lights its 1-hop imports without a click (focus+context).
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Edge selection focuses just the two endpoints — exclusive with node selection.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // "Show only circular" — toggled by clicking the red badge in the top-right.
  const [circularOnly, setCircularOnly] = useState(false);
  // Touched-Files: "focus edits" dims everything except files edited this session (focus+context).
  const [editsOnly, setEditsOnly] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // React Flow can't render identically on the server (it measures node DOM client-side,
  // and the force layout seeds unpositioned nodes randomly), so SSR + hydration diverge
  // → hydration mismatch. Render the canvas only after mount; the server emits a stable
  // placeholder. Data is still fetched server-side and passed in as props.
  const [mounted, setMounted] = useState(false);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  // Select a file from the summary list + center the canvas on it.
  const selectAndPan = useCallback((path: string) => {
    setSelectedId(path);
    setSelectedEdgeId(null);
    const n = rfRef.current?.getNode(path);
    if (n && rfRef.current) rfRef.current.setCenter(n.position.x + 40, n.position.y + 12, { zoom: 1.4, duration: 600 });
  }, []);
  // Toggle "focus edits": dim everything except files edited this session AND zoom to them, so
  // one click both isolates and frames the edited set (the previous separate crosshair was unclear).
  const toggleEditsFocus = useCallback(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    const next = !editsOnly;
    setEditsOnly(next);
    setSummaryOpen(next);
    // fitView runs in the event handler (NOT inside a setState updater, which executes during
    // render — that triggered a MiniMap setState-in-render warning).
    if (next && rfRef.current) {
      const ids = Array.from(touchedInfo.keys()).map((id) => ({ id }));
      if (ids.length) rfRef.current.fitView({ nodes: ids, duration: 600, padding: 0.4 });
    }
  }, [editsOnly, touchedInfo]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNodes(initialNodes), [initialNodes]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setEdges(initialEdges), [initialEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const persistPos = useCallback((path: string, x: number, y: number) => {
    void fetch("/api/code-graph/position", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, x, y }),
    });
  }, []);

  // O(1) lookup for "is this edge circular?" via the React Flow edge id.
  const circularEdgeIds = useMemo(
    () => new Set(edgePayload.filter((e) => e.circular).map((e) => `${e.from}|${e.to}`)),
    [edgePayload],
  );
  // Every file that participates in at least one cycle.
  const circularNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of edgePayload) {
      if (e.circular) {
        s.add(e.from);
        s.add(e.to);
      }
    }
    return s;
  }, [edgePayload]);

  // The file whose neighbourhood is in focus: an explicit selection wins, else the hover.
  const focusNodeId = selectedId ?? hoveredId;

  // Hover/click-to-highlight: edge → focus its two endpoints; node → focus 1-hop
  // neighbours; circular badge → focus every node in a cycle. Fades everything
  // outside the focus set. Matches the pattern used on /map and /db.
  const focusIds = useMemo(() => {
    if (selectedEdgeId) {
      const e = edges.find((x) => x.id === selectedEdgeId);
      return e ? new Set([e.source, e.target]) : null;
    }
    if (focusNodeId) {
      const s = new Set<string>([focusNodeId]);
      for (const e of edgePayload) {
        if (e.from === focusNodeId) s.add(e.to);
        if (e.to === focusNodeId) s.add(e.from);
      }
      return s;
    }
    if (circularOnly) return circularNodeIds;
    if (editsOnly && hasTouched) return new Set(touchedInfo.keys());
    return null;
  }, [focusNodeId, selectedEdgeId, circularOnly, circularNodeIds, edgePayload, edges, editsOnly, hasTouched, touchedInfo]);

  const displayNodes = useMemo(() => {
    if (!focusIds) return nodes;
    return nodes.map((n) => ({
      ...n,
      style: {
        ...n.style,
        opacity: focusIds.has(n.id) ? 1 : 0.15,
        transition: "opacity 120ms",
      },
    }));
  }, [nodes, focusIds]);

  const displayEdges = useMemo(() => {
    if (!focusNodeId && !selectedEdgeId && !circularOnly && !editsOnly) return edges;
    return edges.map((e) => {
      let on = false;
      if (selectedEdgeId) on = e.id === selectedEdgeId;
      else if (focusNodeId) on = e.source === focusNodeId || e.target === focusNodeId;
      else if (circularOnly) on = circularEdgeIds.has(e.id);
      // Focus-edits: keep only edges WITHIN the edited set bright; dim the rest so the
      // canvas isn't a wall of lines.
      else if (editsOnly) on = touchedInfo.has(e.source) && touchedInfo.has(e.target);
      return on
        ? { ...e, zIndex: 20, style: { ...e.style, opacity: 1, strokeWidth: 2 } }
        : { ...e, style: { ...e.style, opacity: 0.04 } };
    });
  }, [edges, focusNodeId, selectedEdgeId, circularOnly, circularEdgeIds, editsOnly, touchedInfo]);

  // Labeled directory containers (the categorization layer) wrapped around each organic
  // cluster — computed from the LIVE node list so they track drags; label-width estimate
  // mirrors the pill rendering (≈6px/char + padding).
  const regions = useMemo(() => {
    const items: RegionInput[] = nodes.map((n) => {
      const label = (n.data as unknown as FileNodeData).label ?? n.id;
      return {
        id: n.id,
        group: filesGroupKey(n.id),
        x: n.position.x,
        y: n.position.y,
        w: Math.min(240, label.length * 6 + 28),
        h: 26,
      };
    });
    return computeGroupRegions(items, { pad: 34 });
  }, [nodes]);

  const circularCount = edgePayload.filter((e) => e.circular).length;

  // Detail panel: the selected file's import neighbours (from the live graph edges).
  const selectedImports = useMemo(
    () => (selectedId ? edgePayload.filter((e) => e.from === selectedId).map((e) => e.to) : []),
    [selectedId, edgePayload],
  );
  const selectedImportedBy = useMemo(
    () => (selectedId ? edgePayload.filter((e) => e.to === selectedId).map((e) => e.from) : []),
    [selectedId, edgePayload],
  );
  const panelOpen = selectedId !== null || (summaryOpen && hasTouched);
  const closePanel = useCallback(() => {
    setSelectedId(null);
    setSummaryOpen(false);
    setEditsOnly(false);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center text-sm text-muted-foreground">
        Loading graph…
      </div>
    );
  }

  return (
    <div className="canvas-dots relative h-screen w-full">
      <ReactFlow
        nodes={displayNodes}
        edges={displayEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          setSelectedId(node.id);
          setSelectedEdgeId(null);
        }}
        onEdgeClick={(_, edge) => {
          setSelectedEdgeId(edge.id);
          setSelectedId(null);
        }}
        onPaneClick={() => {
          setSelectedId(null);
          setSelectedEdgeId(null);
        }}
        onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        onNodeDragStop={(_, node) =>
          persistPos(node.id, node.position.x, node.position.y)
        }
        deleteKeyCode={null}
        colorMode="dark"
        fitView
        minZoom={0.05}
        // Scroll pans the board; hold ⌘/Ctrl while scrolling to zoom (trackpad pinch still zooms).
        panOnScroll
        zoomActivationKeyCode={["Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
      >
        {/* Labeled directory containers around each organic cluster. */}
        <GroupRegions regions={regions} tone="category" />
        <Controls
          position="bottom-right"
          className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
        />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          style={{ width: 140, height: 90 }}
          className="!rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
          nodeColor={() => "#555"}
        />


        <Panel position="top-center" className="glass rounded-full px-1 py-0.5">
          <CanvasTabs
            active="FILES"
            tabs={[
              { value: "ROADMAP", label: "Roadmap", href: "/map?view=ROADMAP" },
              { value: "ARCHITECTURE", label: "Architecture", href: "/map?view=ARCHITECTURE" },
              { value: "DATABASE", label: "Database", href: "/map?view=DATABASE" },
              { value: "FILES", label: "Files", href: "/map?view=FILES" },
            ]}
          />
        </Panel>

        <Panel
          position="top-right"
          className="glass flex items-center gap-3 rounded-xl px-3 py-1.5 text-[11px]"
        >
          <span className="text-muted-foreground">
            {files.length} files · {edgePayload.length} imports
          </span>
          {circularCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setCircularOnly((b) => !b);
                setSelectedId(null);
                setSelectedEdgeId(null);
              }}
              title={
                circularOnly
                  ? "Show all imports"
                  : "Show only files involved in import cycles"
              }
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
                circularOnly
                  ? "bg-red-500/15 text-red-200 ring-1 ring-red-400/40"
                  : "text-red-300 hover:bg-red-500/10",
              )}
            >
              <span
                aria-hidden
                className="inline-block h-0 w-5 border-t border-dashed"
                style={{ borderColor: "#ef4444" }}
              />
              {circularCount} circular
            </button>
          )}
          {hasTouched && (
            <>
              <button
                type="button"
                onClick={toggleEditsFocus}
                title={editsOnly ? "Show all files again" : "Focus + zoom to the files edited this session"}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors",
                  editsOnly
                    ? "bg-teal-500/15 text-teal-200 ring-1 ring-teal-400/40"
                    : "text-teal-300 hover:bg-teal-500/10",
                )}
              >
                <Pencil className="size-3" />
                {touchedInfo.size} edited
              </button>
            </>
          )}
        </Panel>
      </ReactFlow>

      {/* Detail panel — reuses the shared GlassPanel, right-docked like the roadmap/db
          DetailSidebar (NOT floating over the top nav). Shows the selected file's detail, or
          the "edited this session" summary when nothing is selected. */}
      {panelOpen && (
        <GlassPanel className="absolute bottom-3 right-3 top-16 z-10 flex w-72 flex-col rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {selectedId ? "File" : "Edited this session"}
            </span>
            <button
              onClick={closePanel}
              title="Close panel"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {selectedId ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-start gap-1.5">
                    <FileCode2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <h2 className="break-all text-sm font-semibold leading-tight">
                      {selectedId.slice(selectedId.lastIndexOf("/") + 1)}
                    </h2>
                  </div>
                  <div className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                    {selectedId}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(() => {
                    const ti = touchedInfo.get(selectedId);
                    return ti ? (
                      <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300">
                        edited {ti.count}×
                      </span>
                    ) : null;
                  })()}
                  {untested.has(selectedId) && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      untested
                    </span>
                  )}
                </div>
                <button
                  onClick={() =>
                    fetch(`/api/open?path=${encodeURIComponent(selectedId)}`).catch(() => {})
                  }
                  className="w-full rounded-md border border-white/10 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  Open in editor
                </button>
                <FileLinkList label="Imports" paths={selectedImports} onPick={selectAndPan} />
                <FileLinkList label="Imported by" paths={selectedImportedBy} onPick={selectAndPan} />
              </div>
            ) : (
              <ul className="space-y-0.5">
                {editedList.map((e) => (
                  <li key={e.path}>
                    <button
                      onClick={() => selectAndPan(e.path)}
                      title={e.path}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <span className="truncate text-[11px] text-foreground/90">{e.label}</span>
                      <span className="shrink-0 text-[9px] text-teal-300/80">{e.count}×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </GlassPanel>
      )}
    </div>
  );
}

// A labelled, scrollable list of file paths (imports / imported-by) — each row jumps to that
// file on the canvas. Shows nothing when empty.
function FileLinkList({
  label,
  paths,
  onPick,
}: {
  label: string;
  paths: string[];
  onPick: (path: string) => void;
}) {
  if (!paths.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label} ({paths.length})
      </h3>
      <ul className="space-y-0.5">
        {paths.map((p) => (
          <li key={p}>
            <button
              onClick={() => onPick(p)}
              title={p}
              className="block w-full truncate rounded px-1.5 py-0.5 text-left font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            >
              {p.slice(p.lastIndexOf("/") + 1)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
