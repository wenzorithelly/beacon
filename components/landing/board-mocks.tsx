"use client";

/* Faithful, DRAGGABLE replicas of Beacon's canvases — these are REAL React Flow boards
   (the same engine the product uses), so nodes drag, edges route through handles, and the
   dot-grid background is authentic. Node content is built from the SAME Tailwind classes /
   color constants as the live nodes (node-card.tsx / db-table-node.tsx / endpoint-node.tsx /
   files-map-client.tsx) so the mocks can't drift from the product. */

import { createElement, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Box,
  Bug,
  ChevronDown,
  ClipboardList,
  Database,
  FileText,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lock,
  Monitor,
  Network,
  Plug,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/constants";
import { categoryColorClass, categoryHex, categoryRegionClass } from "@/lib/category-color";
import { METHOD_COLOR } from "@/components/graph/db-types";
import "@xyflow/react/dist/style.css";
import "./landing.css";
import "./tour.css";

/* ── edge palette — copied from map-client.tsx / db-map-client.tsx ───────────── */
type EdgeVariant = "contains" | "relates" | "fk" | "depends" | "uses" | "usesW" | "file";
const EV: Record<EdgeVariant, { stroke: string; dash?: string; arrow?: boolean; opacity?: number }> = {
  contains: { stroke: "#7c7c8a", arrow: true },
  relates: { stroke: "#8a8a95", dash: "4 4", arrow: true },
  fk: { stroke: "#6b6b6b", arrow: true },
  depends: { stroke: "#f5b942", dash: "6 4", arrow: true },
  uses: { stroke: "#4ea1ff", dash: "4 4", opacity: 0.7 },
  usesW: { stroke: "#ffb86b", dash: "4 4", opacity: 0.7 },
  file: { stroke: "#ffffff", opacity: 0.16 },
};
function mkEdge(id: string, source: string, sh: string, target: string, th: string, variant: EdgeVariant): Edge {
  const v = EV[variant];
  return {
    id,
    source,
    sourceHandle: sh,
    target,
    targetHandle: th,
    style: { stroke: v.stroke, strokeWidth: 1.5, strokeDasharray: v.dash, opacity: v.opacity ?? 1 },
    markerEnd: v.arrow ? { type: MarkerType.ArrowClosed, color: v.stroke, width: 16, height: 16 } : undefined,
  };
}

/* eight zero-size handles (like the real file nodes) so edges anchor to any side with
   nothing visible poking out of the card */
const HCLS = "!h-0 !w-0 !min-w-0 !border-0 !bg-transparent";
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="tt" className={HCLS} isConnectable={false} />
      <Handle type="source" position={Position.Top} id="st" className={HCLS} isConnectable={false} />
      <Handle type="target" position={Position.Right} id="tr" className={HCLS} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="sr" className={HCLS} isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="tb" className={HCLS} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="sb" className={HCLS} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="tl" className={HCLS} isConnectable={false} />
      <Handle type="source" position={Position.Left} id="sl" className={HCLS} isConnectable={false} />
    </>
  );
}

/* ── shared bits ─────────────────────────────────────────────────────────────── */
type Layer = "FE" | "BE" | "FS";
function LayerBadge({ layer }: { layer?: Layer }) {
  if (!layer) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded bg-white/10 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wide text-zinc-300">
      {layer !== "BE" && <Monitor className="size-2.5" />}
      {layer !== "FE" && <Server className="size-2.5" />}
      {layer}
    </span>
  );
}
// Static status pill — mirrors the live SelectTrigger badge (node-card.tsx): h-5, border, the
// status's own STATUS_META className, a faint chevron to read as the editable control it is.
function StatusPill({ status }: { status: keyof typeof STATUS_META }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("flex h-5 shrink-0 items-center gap-0.5 rounded border px-1.5 text-[10px] font-medium", m.className)}>
      {m.label}
      <ChevronDown className="size-3 opacity-60" />
    </span>
  );
}

/* ── node: roadmap card — mirrors node-card.tsx (Spine card) ─────────────────── */
const PRIORITY_BORDER = [
  "border-[#ff3860]/60 shadow-[0_0_0_1px_rgba(255,56,96,0.15)]",
  "border-[#ff7a45]/50",
  "border-amber-400/35",
  "border-border",
];
// Per-priority hue for the left spine bar (P0 red · P1 brand orange · P2 amber · P3 grey).
const PRIORITY_HUE = ["#ff3860", "#ff7a45", "#fbbf24", "#a1a1aa"] as const;
// The roadmap card's left rail: the work-order rank chip (#1 emerald) over a slim priority bar.
function PrioritySpine({ priority, rank }: { priority: number; rank?: number }) {
  const hue = PRIORITY_HUE[priority] ?? PRIORITY_HUE[3];
  return (
    <div className="flex w-5 shrink-0 flex-col items-center gap-1 self-stretch border-r border-white/[0.06] py-1.5">
      {rank != null && (
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-bold leading-none",
            rank === 1 ? "bg-emerald-400 text-black" : "bg-white/10 text-muted-foreground",
          )}
        >
          {rank}
        </span>
      )}
      <span className="w-[3px] flex-1 rounded-full" style={{ background: hue, opacity: 0.9 }} />
    </div>
  );
}
type RoadData = {
  w: number; title: string; role?: string;
  kind: "feature" | "sub-task" | "bug"; category?: string;
  status: keyof typeof STATUS_META; priority: number; layer?: Layer;
  ring?: "next" | "next2"; rank?: number; working?: boolean;
  signals?: { untested?: number; auth?: boolean; bugs?: number };
};
function RoadNode({ data }: { data: RoadData }) {
  const isBug = data.kind === "bug";
  const border = data.ring === "next"
    ? "border-emerald-400/70 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]"
    : data.ring === "next2" ? "border-emerald-400/25"
      : isBug ? "border-rose-400/50 bg-rose-500/[0.05]"
        : data.working ? "border-sky-400/60 shadow-[0_0_0_1px_rgba(56,160,255,0.25)]"
          : PRIORITY_BORDER[data.priority] ?? "border-border";
  const kindBadge = isBug ? "bg-rose-500/15 text-rose-300" : data.kind === "sub-task" ? "bg-zinc-500/15 text-zinc-300" : "bg-sky-500/15 text-sky-300";
  return (
    <div className={cn("relative flex rounded-lg border bg-card text-card-foreground shadow-sm", border)} style={{ width: data.w }}>
      <PrioritySpine priority={data.priority} rank={data.rank} />
      <div className="min-w-0 flex-1 px-2.5 py-2.5">
        {/* identity row — title left, status pulled to the top-right as the focal counterweight */}
        <div className="flex items-start gap-1.5">
          <div className="flex min-w-0 flex-1 items-start gap-1">
            {data.working && <span className="mt-1.5 inline-block size-2 shrink-0 animate-pulse rounded-full bg-sky-400" />}
            <span className="text-sm font-medium leading-snug">{data.title}</span>
          </div>
          <StatusPill status={data.status} />
        </div>
        {/* identity tags — kind · layer · category */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className={cn("flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide", kindBadge)}>
            {isBug && <Bug className="size-2.5" />}{data.kind}
          </span>
          <LayerBadge layer={data.layer} />
          {data.category && <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", categoryColorClass(data.category))}>{data.category}</span>}
        </div>
        {data.role && <div className="mt-1.5 line-clamp-1 text-[10px] leading-snug text-muted-foreground">{data.role}</div>}
        {(data.signals?.bugs || data.signals?.untested || data.signals?.auth) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {data.signals?.bugs ? <span className="flex items-center gap-1 rounded bg-rose-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-rose-300"><Bug className="size-2.5" /> {data.signals.bugs}</span> : null}
            {data.signals?.untested ? <span className="flex items-center gap-1 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300"><FlaskConical className="size-2.5" /> {data.signals.untested}</span> : null}
            {data.signals?.auth ? <span className="flex items-center gap-1 rounded bg-red-500/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-300"><Lock className="size-2.5" /> auth</span> : null}
          </div>
        )}
      </div>
      <Handles />
    </div>
  );
}

/* ── node: db table — mirrors db-table-node.tsx (draft render) ───────────────── */
type Col = { name: string; type: string; pk?: boolean; fk?: boolean; diff?: "added" | "modified" };
type TableData = { w: number; name: string; accent: string; diffLabel: string; columns: Col[] };
function DbTableNode({ data }: { data: TableData }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-[#161618]/95 text-card-foreground shadow-[0_18px_50px_-22px_rgba(0,0,0,0.9)] backdrop-blur" style={{ width: data.w, borderColor: `${data.accent}59` }}>
      <div className="flex items-center gap-1.5 rounded-t-[11px] px-3 py-2" style={{ background: `${data.accent}14` }}>
        <span className="min-w-0 flex-1 font-mono text-[13px] font-semibold tracking-tight">{data.name}</span>
        <span className="shrink-0 rounded-md border px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ background: `${data.accent}1f`, borderColor: `${data.accent}55`, color: data.accent }}>{data.diffLabel}</span>
      </div>
      <div className="divide-y divide-white/[0.05]">
        {data.columns.map((c) => {
          const tint = c.diff === "added" ? { background: "#7bd38914", boxShadow: "inset 2px 0 0 #7bd389" } : c.diff === "modified" ? { background: "#ffb86b14", boxShadow: "inset 2px 0 0 #ffb86b" } : undefined;
          return (
            <div key={c.name} className="flex items-center gap-2 px-3 py-[7px] text-[12px]" style={tint}>
              {c.pk ? <KeyRound className="size-3 shrink-0 text-amber-300/90" /> : c.fk ? <Link2 className="size-3 shrink-0 text-sky-400/80" /> : <span className="size-3 shrink-0" />}
              <span className="shrink-0 whitespace-nowrap font-mono">{c.name}</span>
              <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground/80">{c.type}</span>
            </div>
          );
        })}
      </div>
      <Handles />
    </div>
  );
}

/* ── node: endpoint — mirrors endpoint-node.tsx ──────────────────────────────── */
type EpData = { w: number; method: string; path: string; isNew?: boolean };
function EndpointNode({ data }: { data: EpData }) {
  const color = METHOD_COLOR[data.method] ?? "#8a8a8a";
  const accent = "#7bd389";
  return (
    <div className={cn("relative flex items-center gap-2 rounded-lg border bg-[#161618]/95 px-2.5 py-1.5 text-card-foreground shadow-[0_12px_36px_-18px_rgba(0,0,0,0.9)] backdrop-blur", data.isNew ? "border-dashed" : "border-white/10")} style={{ width: data.w, ...(data.isNew ? { borderColor: `${accent}66`, background: `${accent}0f` } : {}) }}>
      <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: `${color}22`, color }}>{data.method}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{data.path}</span>
      {data.isNew && <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase" style={{ background: `${accent}26`, color: accent }}>new</span>}
      <Handles />
    </div>
  );
}

/* ── node: architecture component — mirrors node-card.tsx (Blast-Radius card,
   view=ARCHITECTURE): a domain-icon box + title + lifecycle status, the role line, a
   four-metric strip (files · imports-in · imports-out · bugs) and a fan-in dot meter. */
// A distinct icon per architecture domain (compact subset of node-card.tsx's DOMAIN_ICON,
// covering the domains the showcase uses), so the board doesn't read as identical cubes.
const DOMAIN_ICON: Array<[RegExp, LucideIcon]> = [
  [/AUTH|SECURIT/, ShieldCheck],
  [/DATA|\bDB\b|SQL|STORE|STORAGE/, Database],
  [/\bUI\b|FRONT|VIEW|CANVAS|BOARD|DESIGN/, LayoutDashboard],
  [/MCP|\bAPI\b|INTEGRAT/, Plug],
  [/INTEL|GRAPH|\bCODE\b|SYMBOL|SEARCH/, Network],
  [/PLAN|ROADMAP|REVIEW/, ClipboardList],
];
function domainIcon(domain: string): LucideIcon {
  const k = domain.toUpperCase();
  for (const [re, Icon] of DOMAIN_ICON) if (re.test(k)) return Icon;
  return Box;
}
// One metric in the Blast-Radius strip.
function Metric({ value, label, Icon, danger }: { value: number | string; label: string; Icon: LucideIcon; danger?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn("text-[13px] font-semibold leading-none tracking-tight tabular-nums", danger && "text-rose-300")}>{value}</div>
      <div className="mt-0.5 flex items-center justify-center gap-0.5 text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-2.5" />
        {label}
      </div>
    </div>
  );
}
// Fan-in indicator: a 0–5 dot meter + a one-word weight label derived from imports-in.
function FanIn({ importsIn }: { importsIn: number }) {
  const level = importsIn >= 16 ? 5 : importsIn >= 8 ? 4 : importsIn >= 4 ? 3 : importsIn >= 2 ? 2 : importsIn >= 1 ? 1 : 0;
  const label = importsIn >= 8 ? "core dependency" : importsIn >= 3 ? "shared" : importsIn >= 1 ? "leaf" : "isolated";
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="size-1 rounded-full bg-sky-400" style={{ opacity: i < level ? 0.7 : 0.18 }} />
        ))}
      </span>
      {label}
    </span>
  );
}
type ArchData = {
  w: number; title: string; domain: string; role: string;
  status: keyof typeof STATUS_META; layer?: Layer;
  files?: number; in?: number; out?: number; bugs?: number;
};
function ArchNode({ data }: { data: ArchData }) {
  const tint = categoryHex(data.domain);
  const bugs = data.bugs ?? 0;
  return (
    <div className="relative rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground shadow-sm" style={{ width: data.w }}>
      {/* identity row — domain icon left, lifecycle status pulled top-right */}
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in oklab, ${tint} 18%, transparent)`, color: tint }}
        >
          {createElement(domainIcon(data.domain), { className: "size-4" })}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-snug">{data.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", categoryColorClass(data.domain))}>{data.domain}</span>
            <LayerBadge layer={data.layer} />
          </div>
        </div>
        <StatusPill status={data.status} />
      </div>
      {data.role && <div className="mt-2 line-clamp-1 text-[10.5px] leading-snug text-muted-foreground">{data.role}</div>}
      {/* metric strip — full-width even grid */}
      <div className="mt-2.5 grid grid-cols-4 gap-1 border-t border-white/[0.07] pt-2">
        <Metric value={data.files ?? 0} label="files" Icon={FileText} />
        <Metric value={data.in ?? "—"} label="in" Icon={ArrowDownLeft} />
        <Metric value={data.out ?? "—"} label="out" Icon={ArrowUpRight} />
        <Metric value={bugs} label="bug" Icon={Bug} danger={bugs > 0} />
      </div>
      {data.in != null && <div className="mt-2"><FanIn importsIn={data.in} /></div>}
      <Handles />
    </div>
  );
}

/* ── node: file dot — mirrors FileNode in files-map-client.tsx ───────────────── */
type FileData = { label: string; inDegree: number; dirColor: string; layer?: "FE" | "BE"; untested?: boolean };
const FHCLS = "!h-0 !w-0 !min-w-0 !border-0 !bg-transparent";
function FileDot({ data }: { data: FileData }) {
  const r = 5 + Math.min(data.inDegree, 26) * 0.5; // dotRadius()
  const ringPad = data.layer ? 2 : 0;
  const ringBg = data.layer === "FE" ? "#5AC8FA" : data.layer === "BE" ? "#3ECF8E" : undefined;
  return (
    <div className="relative flex flex-col items-center">
      <Handle type="target" position={Position.Top} id="tt" isConnectable={false} className={FHCLS} style={{ top: r + ringPad, left: "50%" }} />
      <span aria-hidden className="rounded-full" style={{ padding: ringPad, background: ringBg, boxShadow: data.untested ? "0 0 0 2px rgba(251,191,36,0.65)" : "none" }}>
        <span aria-hidden className="block rounded-full" style={{ width: r * 2, height: r * 2, backgroundColor: data.dirColor }} />
      </span>
      <span className="pointer-events-none mt-1 max-w-44 truncate text-[10px] leading-tight text-foreground/75">{data.label}</span>
      <Handle type="source" position={Position.Bottom} id="sb" isConnectable={false} className={FHCLS} style={{ top: r + ringPad, bottom: "auto", left: "50%" }} />
    </div>
  );
}

/* ── node: group-by / domain region — mirrors components/graph/group-regions.tsx ──
   The "common region" container behind a cluster of cards: rounded-2xl, label + count
   header, colored by its key through the same palette as the badges. */
type LaneData = { w: number; h: number; label: string; count?: number; colored?: boolean };
function LaneNode({ data }: { data: LaneData }) {
  return (
    <div
      className={cn("pointer-events-none rounded-2xl border", data.colored ? categoryRegionClass(data.label) : "border-white/[0.08] bg-white/[0.015]")}
      style={{ width: data.w, height: data.h }}
    >
      <div className="flex items-baseline gap-2 px-3 py-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{data.label}</span>
        {data.count != null && <span className="text-[10px] tabular-nums text-muted-foreground/50">{data.count}</span>}
      </div>
    </div>
  );
}

const nodeTypes = { road: RoadNode, dbtable: DbTableNode, endpoint: EndpointNode, arch: ArchNode, file: FileDot, lane: LaneNode };

/* ── board chrome + React Flow wrapper ───────────────────────────────────────── */
function MockBoard({ label, height, nodes, edges }: { label: string; height: number; nodes: Node[]; edges: Edge[] }) {
  return (
    <div className="bm-window glass">
      <div className="bm-tabs">
        <span className="h-3 w-3 rounded-full" style={{ background: "#ff7a45", boxShadow: "0 0 7px rgba(255,122,69,.7)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="h-3 w-3 rounded-full" style={{ background: "oklch(1 0 0 / .16)" }} />
        <span className="w-mono ml-3 text-[0.72rem] w-muted">{label}</span>
        <span className="w-mono ml-auto hidden text-[0.66rem] text-muted-foreground/70 sm:block">drag the cards →</span>
      </div>
      <div className="bm-rf" style={{ height }}>
        <ReactFlow
          defaultNodes={nodes}
          defaultEdges={edges}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.06 }}
          minZoom={0.4}
          maxZoom={1.6}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          zoomOnScroll={false}
          panOnScroll={false}
          preventScrolling={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.10)" />
        </ReactFlow>
      </div>
    </div>
  );
}

/* ── roadmap board ───────────────────────────────────────────────────────────── */
const RM_NODES: Node[] = [
  { id: "lane-a", type: "lane", position: { x: 0, y: 0 }, data: { w: 360, h: 580, label: "auth", count: 3, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "lane-b", type: "lane", position: { x: 390, y: 0 }, data: { w: 360, h: 580, label: "billing", count: 3, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "lane-c", type: "lane", position: { x: 780, y: 0 }, data: { w: 360, h: 580, label: "search", count: 3, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "magic", type: "road", position: { x: 30, y: 54 }, zIndex: 1, data: { w: 300, title: "Magic-link sign-in", role: "Email a one-time link, no passwords", kind: "feature", category: "auth", status: "IN_PROGRESS", priority: 1, layer: "FE", ring: "next", rank: 1, working: true } },
  { id: "verify", type: "road", position: { x: 52, y: 250 }, zIndex: 1, data: { w: 268, title: "Issue + verify token", kind: "sub-task", status: "PENDING", priority: 2, layer: "FE" } },
  { id: "pwreset", type: "road", position: { x: 30, y: 392 }, zIndex: 1, data: { w: 300, title: "Password reset", role: "Reuse the magic-link issuer", kind: "feature", category: "auth", status: "DONE", priority: 2, layer: "FE" } },
  { id: "billing", type: "road", position: { x: 420, y: 54 }, zIndex: 1, data: { w: 300, title: "Billing portal", role: "Stripe customer portal + invoices", kind: "feature", category: "billing", status: "PENDING", priority: 0, layer: "FS", signals: { untested: 2, auth: true } } },
  { id: "webhook", type: "road", position: { x: 442, y: 286 }, zIndex: 1, data: { w: 288, title: "Webhook handler", kind: "feature", category: "billing", status: "PENDING", priority: 2, layer: "BE", ring: "next2", rank: 2 } },
  { id: "invoices", type: "road", position: { x: 420, y: 432 }, zIndex: 1, data: { w: 300, title: "Invoice PDF export", kind: "feature", category: "billing", status: "DONE", priority: 2, layer: "BE" } },
  { id: "rate", type: "road", position: { x: 810, y: 54 }, zIndex: 1, data: { w: 300, title: "Rate limiter", role: "Token bucket on the public API", kind: "feature", category: "search", status: "PENDING", priority: 2, layer: "BE" } },
  { id: "audit", type: "road", position: { x: 832, y: 250 }, zIndex: 1, data: { w: 268, title: "Write audit log rows", kind: "sub-task", status: "DONE", priority: 3, layer: "BE" } },
  { id: "bug", type: "road", position: { x: 810, y: 392 }, zIndex: 1, data: { w: 300, title: "Token leaks into request logs", kind: "bug", category: "search", status: "PENDING", priority: 0, layer: "BE", signals: { auth: true } } },
];
const RM_EDGES: Edge[] = [
  mkEdge("e1", "magic", "sb", "verify", "tt", "contains"),
  mkEdge("e2", "rate", "sb", "audit", "tt", "contains"),
  mkEdge("e3", "billing", "sl", "magic", "tr", "depends"),
];

/* ── database board ──────────────────────────────────────────────────────────── */
const DB_NODES: Node[] = [
  { id: "users", type: "dbtable", position: { x: 0, y: 40 }, data: { w: 300, name: "users", accent: "#ffb86b", diffLabel: "modify", columns: [{ name: "id", type: "uuid", pk: true }, { name: "email", type: "text" }, { name: "last_login_at", type: "timestamp", diff: "modified" }, { name: "created_at", type: "timestamp" }] } },
  { id: "magic", type: "dbtable", position: { x: 380, y: 16 }, data: { w: 320, name: "magic_links", accent: "#7bd389", diffLabel: "new", columns: [{ name: "id", type: "uuid", pk: true, diff: "added" }, { name: "token_hash", type: "text", diff: "added" }, { name: "user_id", type: "→ users", fk: true, diff: "added" }, { name: "expires_at", type: "timestamp", diff: "added" }] } },
  { id: "sessions", type: "dbtable", position: { x: 790, y: 52 }, data: { w: 300, name: "sessions", accent: "#7bd389", diffLabel: "new", columns: [{ name: "id", type: "uuid", pk: true, diff: "added" }, { name: "user_id", type: "→ users", fk: true, diff: "added" }, { name: "expires_at", type: "timestamp", diff: "added" }] } },
  { id: "ep-me", type: "endpoint", position: { x: 16, y: 252 }, data: { w: 268, method: "GET", path: "/api/users/me" } },
  { id: "ep-login", type: "endpoint", position: { x: 396, y: 236 }, data: { w: 298, method: "POST", path: "/api/auth/login", isNew: true } },
  { id: "ep-del", type: "endpoint", position: { x: 806, y: 256 }, data: { w: 268, method: "DELETE", path: "/api/auth/session" } },
];
const DB_EDGES: Edge[] = [
  mkEdge("f1", "magic", "sl", "users", "tr", "fk"),
  mkEdge("f2", "sessions", "sl", "users", "tr", "fk"),
  mkEdge("u1", "ep-me", "st", "users", "tb", "uses"),
  mkEdge("u2", "ep-login", "st", "magic", "tb", "usesW"),
  mkEdge("u3", "ep-del", "st", "sessions", "tb", "usesW"),
];

/* ── architecture board — REAL Beacon components, clustered by domain (from
   beacon_entities). Each domain is a GroupRegions container; the cards inside are the
   actual subsystems (title + role + KEEP status + layer). */
const AR_NODES: Node[] = [
  // domain regions (behind the cards) — sized for the taller Blast-Radius cards
  { id: "r-ui", type: "lane", position: { x: 0, y: 0 }, data: { w: 348, h: 548, label: "UI", count: 3, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "r-data", type: "lane", position: { x: 392, y: 0 }, data: { w: 348, h: 548, label: "DATA", count: 3, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "r-intel", type: "lane", position: { x: 784, y: 0 }, data: { w: 348, h: 372, label: "INTEL", count: 2, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "r-plan", type: "lane", position: { x: 784, y: 404 }, data: { w: 348, h: 196, label: "PLAN", count: 1, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  { id: "r-mcp", type: "lane", position: { x: 392, y: 580 }, data: { w: 348, h: 196, label: "MCP", count: 1, colored: true }, draggable: false, selectable: false, zIndex: 0 },
  // UI cluster
  { id: "planui", type: "arch", position: { x: 20, y: 44 }, zIndex: 1, data: { w: 308, title: "Plan UI (/plan)", domain: "UI", status: "KEEP", layer: "FE", role: "Split-screen review page: annotation panel + roadmap / database canvases, tabbed.", files: 5, in: 0, out: 6 } },
  { id: "mapcanvas", type: "arch", position: { x: 20, y: 210 }, zIndex: 1, data: { w: 308, title: "Roadmap canvas (/map)", domain: "UI", status: "KEEP", layer: "FE", role: "React Flow roadmap / architecture canvases — node cards, detail sidebar, edge editing.", files: 6, in: 1, out: 9 } },
  { id: "dbcanvas", type: "arch", position: { x: 20, y: 376 }, zIndex: 1, data: { w: 308, title: "DB design canvas", domain: "UI", status: "KEEP", layer: "FE", role: "Tables + endpoints board with a distinct draft layer and approve / discard actions.", files: 6, in: 0, out: 7 } },
  // DATA cluster
  { id: "ws", type: "arch", position: { x: 412, y: 44 }, zIndex: 1, data: { w: 308, title: "Workspaces (multi-repo)", domain: "DATA", status: "KEEP", layer: "BE", role: "Per-repo registry + data dir + sqlite, the active workspace, request-pin, db self-heal.", files: 1, in: 12, out: 4 } },
  { id: "prisma", type: "arch", position: { x: 412, y: 210 }, zIndex: 1, data: { w: 308, title: "Drizzle data layer", domain: "DATA", status: "KEEP", layer: "BE", role: "Workspace-resolving libSQL client plus node/edge mutations and the roadmap read-model.", files: 6, in: 18, out: 5 } },
  { id: "draft", type: "arch", position: { x: 412, y: 376 }, zIndex: 1, data: { w: 308, title: "Draft store", domain: "DATA", status: "KEEP", layer: "BE", role: "The proposed-schema draft layer; approve → promote into the real DB tables.", files: 4, in: 3, out: 4 } },
  // INTEL cluster
  { id: "daemon", type: "arch", position: { x: 808, y: 44 }, zIndex: 1, data: { w: 308, title: "Code-intelligence daemon", domain: "INTEL", status: "KEEP", layer: "BE", bugs: 1, role: "Per-workspace watchers → polyglot, multi-root, incremental code-graph build → ingest.", files: 6, in: 2, out: 9 } },
  { id: "codegraph", type: "arch", position: { x: 808, y: 210 }, zIndex: 1, data: { w: 308, title: "Code graph & files canvas", domain: "INTEL", status: "KEEP", layer: "BE", role: "Polyglot import-edge index with blast-radius; the hub/lang-aware files canvas.", files: 6, in: 4, out: 6 } },
  // PLAN + MCP clusters (single components)
  { id: "plan", type: "arch", position: { x: 808, y: 448 }, zIndex: 1, data: { w: 308, title: "Plan review loop", domain: "PLAN", status: "KEEP", layer: "BE", role: "Receives proposed plans, blocks for the verdict, bundles annotations + board edits.", files: 6, in: 1, out: 6 } },
  { id: "mcp", type: "arch", position: { x: 412, y: 624 }, zIndex: 1, data: { w: 308, title: "MCP server", domain: "MCP", status: "KEEP", layer: "BE", role: "stdio server exposing beacon_propose_plan / context_for_feature; pins every request.", files: 1, in: 0, out: 9 } },
];
const AR_EDGES: Edge[] = [
  mkEdge("a1", "daemon", "sb", "codegraph", "tt", "contains"), // intra-INTEL parent → sub
  mkEdge("a2", "mcp", "sr", "plan", "tl", "relates"), // MCP drives the plan loop
  mkEdge("a3", "plan", "sl", "draft", "tb", "relates"), // plan loop promotes drafts
  mkEdge("a4", "dbcanvas", "sr", "draft", "tl", "relates"), // DB canvas renders the draft
  mkEdge("a5", "daemon", "sl", "prisma", "tr", "relates"), // intel ingests through the data layer
  mkEdge("a6", "mapcanvas", "sr", "prisma", "tl", "relates"), // canvas reads the data layer
];

/* ── files board (Obsidian dot-graph) ────────────────────────────────────────────
   A realistic slice of a Beacon-sized repo: files clustered by top-level directory
   (color), dots sized by in-degree (the import hubs grow), with import edges converging
   on lib/db.ts + lib/utils.ts the way they really do. Positions are a deterministic
   golden-angle spiral per directory so each cluster reads as a neighbourhood. */
const FILE_DIRS: Record<string, { color: string; cx: number; cy: number }> = {
  lib: { color: "#7bd389", cx: 220, cy: 170 },
  graph: { color: "#c792ea", cx: 720, cy: 150 },
  plan: { color: "#7dd3fc", cx: 1200, cy: 180 },
  api: { color: "#ffb86b", cx: 220, cy: 580 },
  intel: { color: "#2dd4bf", cx: 720, cy: 560 },
  notes: { color: "#ff9ec7", cx: 1200, cy: 580 },
  bin: { color: "#ff8a5b", cx: 220, cy: 980 },
  drizzle: { color: "#5eead4", cx: 720, cy: 980 },
  tests: { color: "#9aa6b2", cx: 1200, cy: 980 },
};
type FileDef = { id: string; label: string; dir: keyof typeof FILE_DIRS; deg: number; layer?: "FE" | "BE"; untested?: boolean };
// hub of each directory listed FIRST (it lands at the cluster centre).
const FILES: FileDef[] = [
  // lib
  { id: "db", label: "lib/db.ts", dir: "lib", deg: 18, layer: "BE" },
  { id: "utils", label: "lib/utils.ts", dir: "lib", deg: 12 },
  { id: "ws", label: "lib/workspaces.ts", dir: "lib", deg: 8, layer: "BE" },
  { id: "consts", label: "lib/constants.ts", dir: "lib", deg: 6 },
  { id: "layer", label: "lib/layer.ts", dir: "lib", deg: 5 },
  { id: "mut", label: "lib/mutations.ts", dir: "lib", deg: 3, layer: "BE", untested: true },
  { id: "catcolor", label: "lib/category-color.ts", dir: "lib", deg: 3 },
  // components/graph
  { id: "ncard", label: "node-card.tsx", dir: "graph", deg: 7, layer: "FE" },
  { id: "handles", label: "handles.tsx", dir: "graph", deg: 6, layer: "FE" },
  { id: "dbtable", label: "db-table-node.tsx", dir: "graph", deg: 3, layer: "FE" },
  { id: "mapc", label: "map-client.tsx", dir: "graph", deg: 2, layer: "FE" },
  { id: "dbmapc", label: "db-map-client.tsx", dir: "graph", deg: 2, layer: "FE" },
  { id: "epnode", label: "endpoint-node.tsx", dir: "graph", deg: 2, layer: "FE" },
  { id: "dsidebar", label: "detail-sidebar.tsx", dir: "graph", deg: 2, layer: "FE" },
  // components/plan
  { id: "mdview", label: "markdown-view.tsx", dir: "plan", deg: 4, layer: "FE" },
  { id: "planws", label: "plan-workspace.tsx", dir: "plan", deg: 2, layer: "FE" },
  { id: "annop", label: "annotation-panel.tsx", dir: "plan", deg: 2, layer: "FE" },
  { id: "planbar", label: "plan-bar.tsx", dir: "plan", deg: 2, layer: "FE" },
  { id: "planhist", label: "plan-history-view.tsx", dir: "plan", deg: 1, layer: "FE" },
  // app/api
  { id: "ingR", label: "api/ingest/route.ts", dir: "api", deg: 1, layer: "BE" },
  { id: "draftR", label: "api/draft/route.ts", dir: "api", deg: 1, layer: "BE" },
  { id: "planR", label: "api/plan/route.ts", dir: "api", deg: 1, layer: "BE" },
  { id: "streamR", label: "api/stream/route.ts", dir: "api", deg: 1, layer: "BE" },
  { id: "nodesR", label: "api/nodes/route.ts", dir: "api", deg: 1, layer: "BE" },
  { id: "baR", label: "api/board-annotations/route.ts", dir: "api", deg: 1, layer: "BE" },
  // intel
  { id: "cgraph", label: "intel/code-graph.ts", dir: "intel", deg: 6, layer: "BE" },
  { id: "iingest", label: "intel/ingest.ts", dir: "intel", deg: 3, layer: "BE" },
  { id: "pipe", label: "intel/pipeline.ts", dir: "intel", deg: 2, layer: "BE" },
  { id: "merge", label: "intel/merge.ts", dir: "intel", deg: 2, layer: "BE" },
  { id: "watch", label: "intel/watch-inline.ts", dir: "intel", deg: 2, layer: "BE", untested: true },
  { id: "iconfig", label: "intel/config.ts", dir: "intel", deg: 2, layer: "BE" },
  // components/notes
  { id: "notes", label: "lib/notes.ts", dir: "notes", deg: 3, layer: "BE" },
  { id: "neditor", label: "note-editor.tsx", dir: "notes", deg: 2, layer: "FE" },
  { id: "ndrawer", label: "notes-drawer.tsx", dir: "notes", deg: 2, layer: "FE" },
  { id: "nmark", label: "note-markdown.ts", dir: "notes", deg: 2 },
  // bin
  { id: "mcp", label: "bin/mcp.ts", dir: "bin", deg: 1, layer: "BE" },
  { id: "beacon", label: "bin/beacon.ts", dir: "bin", deg: 1, layer: "BE" },
  { id: "hook", label: "bin/hook.ts", dir: "bin", deg: 1, layer: "BE" },
  { id: "stophook", label: "bin/stop-hook.ts", dir: "bin", deg: 1, layer: "BE" },
  { id: "doctor", label: "bin/doctor.ts", dir: "bin", deg: 1, layer: "BE" },
  // drizzle
  { id: "schema", label: "drizzle/schema.ts", dir: "drizzle", deg: 3, layer: "BE" },
  { id: "provision", label: "drizzle/provision.ts", dir: "drizzle", deg: 2, layer: "BE" },
  // tests
  { id: "tmapops", label: "map-ops.test.ts", dir: "tests", deg: 0 },
  { id: "tingest", label: "ingest.test.ts", dir: "tests", deg: 0 },
  { id: "tdbdiff", label: "db-diff.test.ts", dir: "tests", deg: 0 },
  { id: "trisk", label: "risk-badges.test.ts", dir: "tests", deg: 0 },
];
const FILE_NODES: Node[] = (() => {
  const seen: Record<string, number> = {};
  return FILES.map((f) => {
    const i = (seen[f.dir] = (seen[f.dir] ?? -1) + 1);
    const d = FILE_DIRS[f.dir];
    const ang = i * 2.399963; // golden angle
    const rad = i === 0 ? 0 : 52 + i * 20;
    return {
      id: f.id,
      type: "file",
      position: { x: Math.round(d.cx + Math.cos(ang) * rad), y: Math.round(d.cy + Math.sin(ang) * rad) },
      data: { label: f.label, inDegree: f.deg, dirColor: d.color, layer: f.layer, untested: f.untested },
    } as Node;
  });
})();
const FILE_LINKS: [string, string][] = [
  // lib internals
  ["mut", "db"], ["mut", "utils"], ["ws", "utils"], ["layer", "utils"], ["db", "ws"], ["db", "schema"],
  // graph → lib + each other
  ["ncard", "handles"], ["ncard", "consts"], ["ncard", "layer"], ["ncard", "catcolor"],
  ["mapc", "ncard"], ["mapc", "utils"], ["dbmapc", "dbtable"], ["dbmapc", "db"],
  ["dbtable", "handles"], ["dbtable", "consts"], ["epnode", "handles"], ["dsidebar", "ncard"],
  // plan
  ["planws", "ncard"], ["planws", "mdview"], ["planws", "utils"], ["annop", "mdview"], ["planbar", "utils"], ["planhist", "mdview"],
  // notes
  ["ndrawer", "neditor"], ["ndrawer", "notes"], ["neditor", "nmark"], ["notes", "db"],
  // api → lib
  ["ingR", "db"], ["ingR", "ws"], ["draftR", "db"], ["planR", "ws"], ["streamR", "ws"], ["nodesR", "db"], ["baR", "db"],
  // intel
  ["iingest", "db"], ["iingest", "cgraph"], ["pipe", "cgraph"], ["merge", "cgraph"], ["watch", "cgraph"], ["cgraph", "utils"], ["iconfig", "utils"],
  // bin
  ["mcp", "db"], ["mcp", "ws"], ["beacon", "ws"], ["hook", "ws"], ["stophook", "ws"], ["doctor", "ws"],
  // drizzle + tests
  ["provision", "schema"], ["tmapops", "db"], ["tingest", "iingest"], ["tdbdiff", "db"], ["trisk", "ncard"],
];
const FILE_EDGES: Edge[] = FILE_LINKS.map(([a, b], i) => mkEdge(`g${i}`, a, "sb", b, "tt", "file"));

/* ── the tabbed surfaces showcase ────────────────────────────────────────────── */
const SURFACE_TABS = [
  { key: "Roadmap", route: "/map", title: "Steer the agent's work order", body: "Features, sub-tasks and dependencies as a graph — priority on the border, a layer stripe for frontend or backend, and the work-on-next ring marking the agent's next move.", board: <MockBoard label="/map · roadmap" height={600} nodes={RM_NODES} edges={RM_EDGES} /> },
  { key: "Database", route: "/db", title: "Schema as a draft, diffed", body: "Proposed tables and endpoints diffed against your live schema — new in green, changed in amber. Foreign keys and endpoint→table usage draw themselves.", board: <MockBoard label="/db · plan vs. repo" height={520} nodes={DB_NODES} edges={DB_EDGES} /> },
  { key: "Architecture", route: "/map", title: "The subsystems, mapped", body: "Real architecture components grouped into domain regions, each with the role it plays — the high-level map the agent keeps current as the codebase grows.", board: <MockBoard label="/map · architecture" height={760} nodes={AR_NODES} edges={AR_EDGES} /> },
  { key: "Files", route: "code-graph", title: "See your codebase, live", body: "A polyglot import graph, Obsidian-style: every file a dot sized by how many files import it, colored by directory, with a layer ring and an amber ring on anything no test imports.", board: <MockBoard label="code-graph · 46 files · 52 imports" height={720} nodes={FILE_NODES} edges={FILE_EDGES} /> },
] as const;

export function SurfacesShowcase() {
  const [tab, setTab] = useState<(typeof SURFACE_TABS)[number]["key"]>("Roadmap");
  const active = SURFACE_TABS.find((t) => t.key === tab)!;
  return (
    <div>
      <div className="mb-9 flex flex-wrap items-center justify-center gap-2">
        {SURFACE_TABS.map((t) => (
          <button key={t.key} className="tour-tab" data-active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.key}
          </button>
        ))}
      </div>

      <div key={`${active.key}-board`} className="tour-fade mx-auto w-full max-w-[1360px]">
        {active.board}
      </div>

      <div key={active.key} className="tour-fade mx-auto mt-6 max-w-2xl text-center">
        <p className="text-[1.02rem] font-semibold tracking-tight">
          <span className="w-mono text-[0.9rem] w-signal">{active.route}</span>
          <span className="mx-2 w-muted">·</span>
          {active.title}
        </p>
        <p className="w-muted mt-1.5 text-[0.92rem] leading-relaxed">{active.body}</p>
      </div>
    </div>
  );
}
