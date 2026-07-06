"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvasTool, CanvasToolToggle } from "@/components/graph/canvas-tool";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ViewportPortal,
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
import { Pencil, X, FileCode2, HelpCircle, Compass } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { CanvasTabs } from "@/components/graph/canvas-tabs";
import { CanvasSearch } from "@/components/graph/canvas-search";
import { FileTree } from "@/components/file-tree/file-tree";
import { buildFileTour } from "@/lib/canvas-tour";
import { useCanvasTour } from "@/components/graph/use-canvas-tour";
import { TourOverlay } from "@/components/graph/tour-overlay";
import {
  fileHaystack,
  matchesQuery,
  searchHits,
  SEARCH_HIT_GLOW,
  type SearchHit,
} from "@/lib/canvas-search";
import { untestedFiles } from "@/lib/test-coverage";
import { type TouchedMap } from "@/lib/touched-files";
import { computeGroupRegions, type Region, type RegionInput } from "@/lib/group-regions";
import { GroupRegions } from "@/components/graph/group-regions";
import { LayerToggle, layerEmphasisMatch } from "@/components/graph/layer-toggle";
import { CanvasPopover } from "@/components/graph/canvas-popover";
import { classifyFileLayers } from "@/lib/file-layer";
import { buildGroupKeys } from "@/lib/file-groups";
import { LAYER_COLORS, LAYER_META, layerStripeCss, type Layer } from "@/lib/layer";
import { LodReporter, useZoomLOD } from "@/components/graph/use-zoom-lod";
import { FILES_LOD, type Lod } from "@/lib/zoom-lod";
import { categoryHex } from "@/lib/category-color";
import { cn } from "@/lib/utils";
import { useColorMode } from "@/components/theme/use-color-mode";

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


interface SimNode extends SimulationNodeDatum {
  id: string;
  pinned: boolean;
  radius: number;
}

// Collision radius for a DOT node: the dot itself plus room for its zoom-in label not to
// sit on the neighbouring dot. Much smaller than the old full-label-width pills — that's
// what lets the web breathe while staying dense enough to read as one organism.
function collisionRadiusFor(inDegree: number): number {
  return dotRadius(inDegree) + 22;
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

// Anchor point per group: biggest folders first, on a wide grid scaled so neighbouring
// clusters have room to breathe. Deterministic (sorted by size desc, then name).
function dirAnchors(groupKeys: Map<string, string>): Map<string, { x: number; y: number }> {
  const counts = new Map<string, number>();
  for (const g of groupKeys.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
  const dirs = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cols = Math.max(1, Math.ceil(Math.sqrt(dirs.length * 2.5))); // wide grid (~2:1)
  // Dots pack far tighter than the old label pills, so clusters need less room.
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
  groupKeys: Map<string, string>,
): Map<string, { x: number; y: number }> {
  const anchors = dirAnchors(groupKeys);
  const anchorOf = (path: string) => anchors.get(groupKeys.get(path) ?? "(root)")!;
  const simNodes: SimNode[] = files.map((f) => {
    const seed = seedFor(f.path);
    const a = anchorOf(f.path);
    return {
      id: f.path,
      // Seed near the directory's anchor (irregular spread) so the cluster forms
      // there but keeps an organic silhouette.
      x: a.x + seed.x * 0.5,
      y: a.y + seed.y * 0.5,
      pinned: false,
      radius: collisionRadiusFor(f.inDegree ?? 0),
    };
  });

  const simLinks = edges
    .filter((e) => e.from !== e.to)
    .map((e) => ({ source: e.from, target: e.to }));
  const sameDir = (a: string, b: string) => groupKeys.get(a) === groupKeys.get(b);

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((n) => n.id)
        .distance(100)
        // INTRA-directory links shape the organic web inside each cluster; CROSS-directory
        // links barely tug (this repo imports across folders constantly — at full strength
        // they weld every cluster into one central blob and the regions overlap).
        .strength((l) => {
          const s = typeof l.source === "object" ? (l.source as SimNode).id : String(l.source);
          const t = typeof l.target === "object" ? (l.target as SimNode).id : String(l.target);
          return sameDir(s, t) ? 0.5 : 0.02;
        }),
    )
    // Repulsion + breathing room so dots and edges read individually.
    .force("charge", forceManyBody<SimNode>().strength(-260).distanceMax(800))
    // Soft collision — hard collide hex-packs equal dots into a lattice; soft keeps the
    // irregular, organic spacing the link structure produces.
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => d.radius).strength(0.6),
    )
    // Gentle directory gravity: each folder's web settles in its own neighbourhood (the
    // color groups stay spatially coherent) without flattening into a grid.
    .force("clusterX", forceX<SimNode>((d) => anchorOf(d.id).x).strength(0.1))
    .force("clusterY", forceY<SimNode>((d) => anchorOf(d.id).y).strength(0.115))
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
  // Hub scoring (deterministic, cached at ingest) — high-inDegree files render bigger dots.
  inDegree?: number;
  // The top-level directory's hue (color-group categorization, Obsidian-style).
  dirColor: string;
  // Deterministic frontend/backend/fullstack classification (lib/file-layer) — renders a thin
  // layer-colored ring around the dot. Null/undefined = neutral, no ring.
  layer?: Layer | null;
  // Touched-Files overlay (driven by the PostToolUse hook via the touched store).
  touched?: boolean;
  count?: number; // edits this session
  recency?: number; // 0..1, newest edit = 1 — drives glow intensity (recency heat)
  isNewest?: boolean; // the single most-recently edited file → one-shot pulse
}

// Dot radius from in-degree (Obsidian: "the more notes reference it, the bigger it gets").
function dotRadius(inDegree: number): number {
  return 5 + Math.min(inDegree, 26) * 0.5; // 5..18px
}

// memo: the files graph can hold hundreds of nodes; without this every dot re-rendered on
// every pan/zoom/drag frame. Props (just `data`) are stable per node, so memo bails out.
const FileNode = memo(function FileNode({ data }: { data: FileNodeData }) {
  // Obsidian-style node: a DOT sized by how many files import it, colored by its top-level
  // directory (the color-group categorization), with the filename underneath that fades in
  // with zoom — far out you read shape and color, close in you read names. The two Handles
  // are required for React Flow to render import edges; styled invisible.
  //
  // Signal encodings stay non-color-alone (tooltip + badges carry meaning):
  //   • untested → amber ring around the dot
  //   • touched  → teal glow scaled by recency + edit-count badge + one-shot pulse
  const lod = useZoomLOD(FILES_LOD);
  const touched = !!data.touched;
  const recency = data.recency ?? 0;
  const inDeg = data.inDegree ?? 0;
  const r = dotRadius(inDeg);
  // Layer ring: 2px of layer color wrapped around the dot (padding, not box-shadow — the
  // amber untested ring and teal touched glow stay free to stack on top).
  const layer = data.layer ?? null;
  const ringPad = layer ? 2 : 0;
  // Text fade threshold, like Obsidian's: every name at reading zoom; only hubs at mid
  // zoom; none when far (the directory summaries take over).
  const showLabel = lod === "full" || (lod === "mid" && inDeg >= 4);
  const hubNote = inDeg > 0 ? ` · imported by ${inDeg}` : "";
  // A file is never "fullstack" — one reached from both sides is SHARED (split ring).
  const layerNote = layer
    ? ` · ${layer === "fullstack" ? "shared (used by frontend + backend)" : LAYER_META[layer].label.toLowerCase()}`
    : "";
  const title = touched
    ? `${data.tooltip} · edited ${data.count ?? 0}× this session${hubNote}${layerNote}`
    : data.untested
      ? `${data.tooltip} · no test imports this file${hubNote}${layerNote}`
      : `${data.tooltip}${hubNote}${layerNote}`;
  return (
    <div title={title} className="relative flex flex-col items-center">
      {/* Both handles sit at the DOT'S CENTER (not the container edges, which include the
          label below) so every edge line meets the circle dead-on from any direction. */}
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="!h-0 !w-0 !min-w-0 !border-0 !bg-transparent"
        style={{ top: r + ringPad, left: "50%" }}
      />
      <span
        aria-hidden
        className={cn("rounded-full", data.isNewest && "animate-touch-pulse")}
        style={{
          padding: ringPad,
          background: layer ? layerStripeCss(layer) : undefined,
          boxShadow: touched
            ? `0 0 ${8 + Math.round(recency * 14)}px ${2 + Math.round(recency * 3)}px rgba(45,212,191,${(0.35 + recency * 0.45).toFixed(2)})`
            : data.untested
              ? "0 0 0 2px rgba(251,191,36,0.65)"
              : "none",
        }}
      >
        <span
          aria-hidden
          className="block rounded-full"
          style={{ width: r * 2, height: r * 2, backgroundColor: data.dirColor }}
        />
      </span>
      {touched && (data.count ?? 0) > 0 && (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-teal-400 px-0.5 text-[8px] font-bold text-background ring-1 ring-background"
        >
          {data.count}
        </span>
      )}
      {showLabel && (
        <span
          className={cn(
            "pointer-events-none mt-1 max-w-44 truncate text-[10px] leading-tight",
            touched ? "font-semibold text-teal-100" : "text-foreground/75",
          )}
        >
          {data.label}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="!h-0 !w-0 !min-w-0 !border-0 !bg-transparent"
        style={{ top: r + ringPad, bottom: "auto", left: "50%" }}
      />
    </div>
  );
});

const nodeTypes = { file: FileNode };

// Always-on layer atmosphere behind each directory cluster: a soft radial GLOW in the
// cluster's dominant layer color, fading to transparent — no edges, no boxes over the
// organic web (rectangular tints read as UI chrome and overlap badly when clusters
// interleave). Mixed/shared-dominant clusters get no glow: there's no one side to claim
// them. Far zoom hands over to the opaque labeled GroupRegions summaries.
function LayerTintRegions({
  regions,
  dominant,
}: {
  regions: Region[];
  dominant: Map<string, Layer | null>;
}) {
  return (
    <ViewportPortal>
      {regions.map((r) => {
        const layer = dominant.get(r.key);
        if (!layer || layer === "fullstack") return null;
        return (
          <div
            key={r.key}
            style={{
              position: "absolute",
              // Oversize the halo and recenter so the fade extends past the cluster's
              // bounding box instead of stopping at it.
              transform: `translate(${r.x - r.w * 0.15}px, ${r.y - r.h * 0.15}px)`,
              width: r.w * 1.3,
              height: r.h * 1.3,
              pointerEvents: "none",
              zIndex: 0,
              background: `radial-gradient(closest-side, ${LAYER_COLORS[layer]} 0%, transparent 72%)`,
              opacity: 0.1,
            }}
          />
        );
      })}
    </ViewportPortal>
  );
}

export function FilesMapClient({
  files,
  edges: edgePayload,
  touched,
  hasFrontend = false,
  classificationRoots = [],
}: {
  files: FileGraphFile[];
  edges: FileGraphEdge[];
  touched?: TouchedMap;
  /** Gates every layer visual (rings, zone tints, the FE/BE/FS toggle) — a pure-backend
   *  repo renders the canvas exactly as before. */
  hasFrontend?: boolean;
  /** Top-level dirs (declared at beacon-init, ProjectMeta.classificationRoots) under which
   *  files group one level deeper — keeps a minority `frontend` from collapsing into one
   *  flat blob. Empty → adaptive grouping. */
  classificationRoots?: string[];
}) {
  // Run the simulation every load — it's deterministic (seeded from paths), so the picture
  // is stable across reloads, and layout improvements reach existing boards instead of being
  // frozen by stored positions from an older algorithm. Drags still work within a session.
  // Adaptive grouping: top-level dirs, or one level deeper inside a dominant package
  // (single-`app/` repos get app/services, app/routers, … instead of one giant blob).
  const groupKeys = useMemo(
    () => buildGroupKeys(files.map((f) => f.path), classificationRoots),
    [files, classificationRoots],
  );
  const positions = useMemo(
    () => runForceLayout(files, edgePayload, groupKeys),
    [files, edgePayload, groupKeys],
  );

  // Test-Coverage Flags: files no test file imports (deterministic, from the import edges).
  const untested = useMemo(
    () => untestedFiles(files.map((f) => f.path), edgePayload),
    [files, edgePayload],
  );

  // Deterministic frontend/backend/fullstack classification (seeds + reverse-import BFS) —
  // computed client-side from data already on hand; nothing persisted.
  const fileLayers = useMemo(
    () => (hasFrontend ? classifyFileLayers(files.map((f) => f.path), edgePayload) : null),
    [hasFrontend, files, edgePayload],
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
  // Files edited this session, for the side-panel tree (FileTree groups + sorts them by path).
  const editedList = useMemo(
    () => Array.from(touchedInfo.entries()).map(([path, v]) => ({ path, count: v.count })),
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
          dirColor: categoryHex(groupKeys.get(f.path) ?? "(root)"),
          layer: fileLayers?.get(f.path) ?? null,
          touched: !!ti,
          count: ti?.count ?? 0,
          recency: ti?.recency ?? 0,
          isNewest: ti?.isNewest ?? false,
        },
      };
    });
  }, [files, positions, untested, touchedInfo, fileLayers, groupKeys]);

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
        // NON-INTERACTIVE: an edge passing over a dot used to intercept the pointer when it
        // brightened, which un-hovered the node, dropped the edge back down, re-hovered the
        // node… — the blinking glitch. Lines are read-only; interaction lives on the dots.
        selectable: false,
        focusable: false,
        style: {
          pointerEvents: "none" as const,
          // VISIBLE but thin — the connections are the point of this canvas. They read
          // cleanly now that nodes are small dots instead of wide label pills.
          ...(e.circular
            ? { stroke: "#f87171", strokeDasharray: "5 3", strokeWidth: 1.5, opacity: 0.6 }
            : { stroke: "#8b8b94", strokeWidth: 1, opacity: 0.3 }),
        },
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
  // React Flow colorMode tracks the app theme (see useColorMode) so light theme isn't overridden.
  const colorMode = useColorMode();
  // Touched-Files: "focus edits" dims everything except files edited this session (focus+context).
  const [editsOnly, setEditsOnly] = useState(false);
  // Layer emphasis (FE/BE/FS pills): dims non-matching files instead of hiding them.
  const [layerEmphasis, setLayerEmphasis] = useState<Layer | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // React Flow can't render identically on the server (it measures node DOM client-side,
  // and the force layout seeds unpositioned nodes randomly), so SSR + hydration diverge
  // → hydration mismatch. Render the canvas only after mount; the server emits a stable
  // placeholder. Data is still fetched server-side and passed in as props.
  const [mounted, setMounted] = useState(false);
  // Semantic-zoom level, lifted out of the React Flow context (far → directory summaries).
  const [lod, setLod] = useState<Lod>("full");
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const { tool: canvasTool, setTool: setCanvasTool, flowProps: canvasToolProps } = useCanvasTool();
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

  // Guided architecture tour: deterministic, dependency-ordered walkthrough computed entirely
  // client-side from the import graph already in memory (no LLM, no fetch). Each step frames its
  // node(s); the overview step frames the whole board.
  const tourSteps = useMemo(
    () => buildFileTour(files, edgePayload, groupKeys),
    [files, edgePayload, groupKeys],
  );
  const focusTourStep = useCallback((step: { focusIds: string[] }) => {
    if (!rfRef.current) return;
    if (step.focusIds.length) {
      rfRef.current.fitView({
        nodes: step.focusIds.map((id) => ({ id })),
        duration: 700,
        padding: 0.3,
        maxZoom: 1.1,
      });
    } else {
      rfRef.current.fitView({ duration: 700, padding: 0.1 });
    }
  }, []);
  const tour = useCanvasTour(tourSteps, focusTourStep);

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

  // Live search spotlight: match files by path + language. The match set (node ids = paths)
  // overrides the hover/click focus while a query is active; the capped list drives the popover.
  const searchActive = searchQuery.trim().length > 0;
  const searchMatchIds = useMemo(() => {
    if (!searchActive) return null;
    const s = new Set<string>();
    for (const f of files) if (matchesQuery(fileHaystack(f), searchQuery)) s.add(f.path);
    return s;
  }, [files, searchQuery, searchActive]);
  const searchHitList = useMemo<SearchHit[]>(() => {
    if (!searchActive) return [];
    return searchHits(
      files,
      searchQuery,
      (f) => fileHaystack(f),
      (f) => ({ id: f.path, label: f.path, sublabel: f.lang ?? undefined, kind: "file" }),
    );
  }, [files, searchQuery, searchActive]);

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

  // A live tour step takes precedence over search, which takes precedence over hover/click.
  // (Null on the overview step → nothing dims.)
  const tourFocusIds = tour.focusIds;
  const effectiveFocusIds = tourFocusIds ?? searchMatchIds ?? focusIds;
  // Search hits AND tour steps get the bright accent halo, not merely "less dimmed".
  const spotlightIds = searchMatchIds ?? tourFocusIds;

  // Files the layer-emphasis pills push back (FE/BE keep fullstack bright; unclassified
  // files always dim while a pill is on). Baseline lens only — focus/search take over.
  const layerDimIds = useMemo(() => {
    if (!layerEmphasis || !fileLayers) return null;
    const s = new Set<string>();
    for (const f of files)
      if (!layerEmphasisMatch(layerEmphasis, fileLayers.get(f.path) ?? null)) s.add(f.path);
    return s;
  }, [layerEmphasis, fileLayers, files]);

  const displayNodes = useMemo(() => {
    if (!effectiveFocusIds) {
      if (!layerDimIds) return nodes;
      return nodes.map((n) =>
        layerDimIds.has(n.id)
          ? { ...n, style: { ...n.style, opacity: 0.15, transition: "opacity 120ms" } }
          : n,
      );
    }
    return nodes.map((n) => {
      const on = effectiveFocusIds.has(n.id);
      return {
        ...n,
        // Search hits and tour steps get an accent halo so the focused file pops, not just
        // "less dimmed".
        zIndex: on && spotlightIds ? 10 : n.zIndex,
        style: {
          ...n.style,
          opacity: on ? 1 : 0.15,
          boxShadow: on && spotlightIds ? SEARCH_HIT_GLOW : n.style?.boxShadow,
          borderRadius: on && spotlightIds ? 9999 : n.style?.borderRadius,
          transition: "opacity 120ms, box-shadow 120ms",
        },
      };
    });
  }, [nodes, effectiveFocusIds, spotlightIds, layerDimIds]);

  const displayEdges = useMemo(() => {
    // Tour spotlight: while a step frames a subset, only edges within it stay bright.
    if (tourFocusIds) {
      return edges.map((e) =>
        tourFocusIds.has(e.source) && tourFocusIds.has(e.target)
          ? { ...e, style: { ...e.style, stroke: "#e4e4e7", opacity: 0.9, strokeWidth: 1.4 } }
          : { ...e, style: { ...e.style, opacity: 0.05 } },
      );
    }
    // Search spotlight: only edges between two matched files stay bright.
    if (searchMatchIds) {
      return edges.map((e) =>
        searchMatchIds.has(e.source) && searchMatchIds.has(e.target)
          ? { ...e, style: { ...e.style, stroke: "#e4e4e7", opacity: 0.95, strokeWidth: 1.6 } }
          : { ...e, style: { ...e.style, opacity: 0.05 } },
      );
    }
    if (!focusNodeId && !selectedEdgeId && !circularOnly && !editsOnly) {
      if (!layerDimIds) return edges;
      // Layer emphasis: an edge touching a dimmed file fades with it.
      return edges.map((e) =>
        layerDimIds.has(e.source) || layerDimIds.has(e.target)
          ? { ...e, style: { ...e.style, opacity: 0.05 } }
          : e,
      );
    }
    return edges.map((e) => {
      let on = false;
      if (selectedEdgeId) on = e.id === selectedEdgeId;
      else if (focusNodeId) on = e.source === focusNodeId || e.target === focusNodeId;
      else if (circularOnly) on = circularEdgeIds.has(e.id);
      // Focus-edits: keep only edges WITHIN the edited set bright; dim the rest so the
      // canvas isn't a wall of lines.
      else if (editsOnly) on = touchedInfo.has(e.source) && touchedInfo.has(e.target);
      return on
        ? // No zIndex jump (that re-stacked the svg layer mid-hover and fed the glitch) —
          // brightness alone separates the focused neighbourhood.
          { ...e, style: { ...e.style, stroke: "#e4e4e7", opacity: 0.95, strokeWidth: 1.6 } }
        : { ...e, style: { ...e.style, opacity: 0.05 } };
    });
  }, [edges, focusNodeId, selectedEdgeId, circularOnly, circularEdgeIds, editsOnly, touchedInfo, searchMatchIds, layerDimIds, tourFocusIds]);

  // Directory regions are a FAR-ZOOM aid only: zoomed out, the dots are specks, so each
  // cluster renders one labeled summary block. At reading zoom the color groups carry the
  // categorization Obsidian-style — no boxes over the organic web.
  const regions = useMemo(() => {
    const items: RegionInput[] = nodes.map((n) => {
      const d = n.data as unknown as FileNodeData;
      const r = dotRadius(d.inDegree ?? 0);
      return {
        id: n.id,
        group: groupKeys.get(n.id) ?? "(root)",
        x: n.position.x,
        y: n.position.y,
        w: r * 2,
        h: r * 2,
      };
    });
    return computeGroupRegions(items, { pad: 60 });
  }, [nodes, groupKeys]);

  // Dominant layer per directory cluster — majority over its CLASSIFIED files (a strict
  // winner; ties or an all-neutral cluster get no tint). Drives the faint zone tints.
  const dominantLayer = useMemo(() => {
    const m = new Map<string, Layer | null>();
    if (!fileLayers) return m;
    const counts = new Map<string, Map<Layer, number>>();
    for (const f of files) {
      const layer = fileLayers.get(f.path);
      if (!layer) continue;
      const g = groupKeys.get(f.path) ?? "(root)";
      const c = counts.get(g) ?? new Map<Layer, number>();
      c.set(layer, (c.get(layer) ?? 0) + 1);
      counts.set(g, c);
    }
    for (const [g, c] of counts) {
      let best: Layer | null = null;
      let bestN = 0;
      let tied = false;
      for (const [layer, n] of c) {
        if (n > bestN) {
          best = layer;
          bestN = n;
          tied = false;
        } else if (n === bestN) tied = true;
      }
      m.set(g, tied ? null : best);
    }
    return m;
  }, [fileLayers, files, groupKeys]);

  // Legend entries: every directory group with its hue and size, biggest first.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groupKeys.values()) counts.set(g, (counts.get(g) ?? 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([group, count]) => ({ group, count, color: categoryHex(group) }));
  }, [groupKeys]);

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
        {...canvasToolProps}
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
        colorMode={colorMode}
        fitView
        // Land at the colorful dot web, never on the far-zoom summary blocks: the fit can
        // zoom out to take in the whole graph, but not past the dots' readable range.
        fitViewOptions={{ padding: 0.1, minZoom: 0.18, maxZoom: 0.9 }}
        minZoom={0.05}
        // Scroll pans the board; hold ⌘/Ctrl while scrolling to zoom (trackpad pinch still zooms).
        panOnScroll
        zoomActivationKeyCode={["Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
      >
        {/* Far zoom only: one labeled summary block per directory cluster. */}
        <GroupRegions regions={lod === "far" ? regions : []} tone="category" lod={lod} />
        {/* Reading/mid zoom: faint frontend/backend zone tints behind the clusters. */}
        {hasFrontend && (
          <LayerTintRegions regions={lod === "far" ? [] : regions} dominant={dominantLayer} />
        )}
        <LodReporter onLod={setLod} thresholds={FILES_LOD} />
        <Controls
          position="bottom-right"
          className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
        />
        <Panel position="bottom-left" style={{ marginBottom: 118 }}>
          <CanvasToolToggle tool={canvasTool} onChange={setCanvasTool} />
        </Panel>
        {/* Legend popover stacked above the Controls (+/-/fit/lock), matching the other boards. */}
        <Panel position="bottom-right" style={{ marginBottom: 152 }}>
          <CanvasPopover
            title="Legend"
            trigger={(open, toggle) => (
              <button
                type="button"
                onClick={toggle}
                title="Legend"
                className={cn(
                  "glass flex size-8 items-center justify-center rounded-lg transition-colors",
                  open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <HelpCircle className="size-4" />
              </button>
            )}
          >
            <ul className="space-y-1.5 text-[10.5px] text-muted-foreground">
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full bg-zinc-400" />
                <span>a file · bigger dot = more files import it</span>
              </li>
              {hasFrontend && (
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ boxShadow: `inset 0 0 0 2px ${LAYER_COLORS.frontend}` }}
                  />
                  <span>colored ring · frontend / backend layer</span>
                </li>
              )}
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-px w-6 bg-[#4a4a52]" />
                <span>line · imports another file</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-block h-px w-6 bg-red-400" />
                <span>red · part of an import cycle</span>
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden className="inline-flex shrink-0 gap-0.5">
                  <span className="inline-block size-2 rounded-full bg-violet-400" />
                  <span className="inline-block size-2 rounded-full bg-amber-400" />
                </span>
                <span>dot color · its directory (chips, top-right)</span>
              </li>
            </ul>
          </CanvasPopover>
        </Panel>
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          style={{ width: 140, height: 90 }}
          className="!overflow-hidden !rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
          nodeColor={() => "#555"}
        />


        {/* Guided tour entry — top-left, clear of the top nav. Hidden while touring (the
            left-docked overlay covers this spot and carries its own exit). */}
        {tourSteps.length > 0 && !tour.active && (
          <Panel position="top-left" className="!mt-14">
            <button
              type="button"
              onClick={tour.start}
              title="Guided, dependency-ordered walkthrough of the codebase"
              className="glass flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <Compass className="size-3.5" />
              Start tour
            </button>
          </Panel>
        )}

        {/* View tabs — anchored to the RIGHT edge (was top-center) so they can't drift into the
            left-pinned top nav. The search/stats row (`!mt-14`) and the legend (`!mt-24`) stack
            below; all three shift left together when the file detail panel opens. */}
        <Panel
          position="top-right"
          className={cn(
            "glass rounded-full px-1 py-0.5 transition-[margin] duration-200",
            panelOpen && "!mr-[300px]",
          )}
        >
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

        {/* Color legend: which hue is which directory. Click a chip to fly to that cluster. */}
        <Panel
          position="top-right"
          className={cn(
            "glass !mt-24 flex max-w-[300px] flex-wrap items-center justify-end gap-x-2.5 gap-y-1 rounded-xl px-3 py-1.5 transition-[margin] duration-200",
            panelOpen && "!mr-[300px]",
          )}
        >
          {legend.map((g) => (
            <button
              key={g.group}
              type="button"
              onClick={() => {
                const ids = files
                  .filter((f) => (groupKeys.get(f.path) ?? "(root)") === g.group)
                  .map((f) => ({ id: f.path }));
                if (ids.length)
                  rfRef.current?.fitView({ nodes: ids, duration: 600, padding: 0.3, maxZoom: 1 });
              }}
              title={`${g.count} files — click to zoom to ${g.group}`}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: g.color }}
              />
              {g.group}
            </button>
          ))}
        </Panel>

        <Panel
          position="top-right"
          className={cn(
            "!mt-14 flex items-center gap-2 transition-[margin] duration-200",
            panelOpen && "!mr-[300px]",
          )}
        >
          <CanvasSearch
            query={searchQuery}
            onQuery={setSearchQuery}
            hits={searchHitList}
            placeholder="Find a file…"
            onPick={(id) => {
              setSearchQuery("");
              selectAndPan(id);
            }}
            onZoomToMatches={() => {
              if (!searchMatchIds?.size) return;
              rfRef.current?.fitView({
                nodes: [...searchMatchIds].map((id) => ({ id })),
                duration: 600,
                padding: 0.3,
              });
            }}
          />
          {hasFrontend && (
            <LayerToggle
              value={layerEmphasis}
              onChange={setLayerEmphasis}
              options={["frontend", "backend"]}
            />
          )}
          <div className="glass flex items-center gap-3 rounded-xl px-3 py-1.5 text-[11px]">
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
          </div>
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
              // Same "edited this session" data, now as the shared visual file tree (grouped by
              // directory, edit count as right-aligned meta). Click opens the file in the editor.
              <FileTree
                files={editedList.map((e) => ({ path: e.path, meta: `${e.count}×` }))}
                emptyLabel="No files edited this session yet."
              />
            )}
          </div>
        </GlassPanel>
      )}

      {/* Guided tour: left-docked steps panel (clear of the right-docked detail panel). */}
      {tour.active && tour.step && (
        <TourOverlay
          steps={tourSteps}
          index={tour.index}
          onPrev={tour.prev}
          onNext={tour.next}
          onExit={tour.stop}
          onGoto={tour.goto}
        />
      )}
    </div>
  );
}

// A labelled file list (imports / imported-by) rendered as the shared file tree — each row
// jumps to that file on the canvas. Shows nothing when empty.
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
      <FileTree files={paths.map((p) => ({ path: p }))} onSelect={onPick} />
    </div>
  );
}
