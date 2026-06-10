"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { DbTableNode, type DbTableNodeData } from "@/components/graph/db-table-node";
import { EndpointNode, type EndpointNodeData } from "@/components/graph/endpoint-node";
import {
  ANNOTATION_ACCENT,
  AnnotationCardNode,
  type AnnotationNodeData,
  type BoardAnnotationPayload,
} from "@/components/graph/annotation-node";
import { anchorAnnotations } from "@/lib/annotation-anchors";
import type { TextAnnotation } from "@/lib/annotations";
import { DbEditContext, type DbEditApi } from "@/components/graph/db-edit-context";
import { DbDetailSidebar } from "@/components/graph/db-detail-sidebar";
import { ACCESS_COLOR, neighborIds } from "@/components/graph/db-types";
import {
  CanvasPopover,
  Chip,
  PopoverSection,
} from "@/components/graph/canvas-popover";
import { CanvasTabs } from "@/components/graph/canvas-tabs";
import { accessForMethod } from "@/lib/access";
import { computeGroupRegions, type RegionInput } from "@/lib/group-regions";
import { primaryTableFor, UNATTACHED_GROUP } from "@/lib/db-board-layout";
import { GroupRegions } from "@/components/graph/group-regions";
import { LodReporter } from "@/components/graph/use-zoom-lod";
import type { Lod } from "@/lib/zoom-lod";
import { diffDraftTables, diffDraftEndpoints, type NodeDiff } from "@/lib/db-diff";
import { cn } from "@/lib/utils";
import type {
  DbRelationPayload,
  DbSelection,
  DbTablePayload,
  DraftDoc,
  EndpointPayload,
} from "@/components/graph/db-types";
import type { DraftGraph } from "@/lib/design";
import {
  Check,
  HelpCircle,
  LayoutGrid,
  PanelRight,
  Redo2,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";

// Re-export so existing call sites keep working while the canonical home is db-types.
export type { DbSelection };

import { DeletableEdge } from "@/components/graph/deletable-edge";

const nodeTypes = { dbTable: DbTableNode, endpoint: EndpointNode, annotation: AnnotationCardNode };
const edgeTypes = { deletable: DeletableEdge };
const STORAGE_KEY = "beacon:db-draft";
const EMPTY_DOC: DraftDoc = {
  proposedAt: 0,
  status: "pending",
  tables: [],
  relations: [],
  endpoints: [],
};

type DbNode = Node<DbTableNodeData> | Node<EndpointNodeData> | Node<AnnotationNodeData>;
// `rev` bumps on EVERY history change (incl. boot/adopt resets) and drives render rebuilds.
// `edited` is true only after a genuine USER edit — boot/new-proposal resets clear it — so the
// parent's "Submit feedback / disable Approve" signal never fires from merely opening the board.
type History = { past: DraftDoc[]; present: DraftDoc; future: DraftDoc[]; rev: number; edited: boolean };

// ── doc → render payloads (draft tables/endpoints are just payloads with source "DRAFT") ──
function draftTablePayloads(doc: DraftDoc): DbTablePayload[] {
  return doc.tables.map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    description: t.description,
    source: "DRAFT",
    x: t.x,
    y: t.y,
    columns: t.columns,
  }));
}
function draftEndpointPayloads(doc: DraftDoc): EndpointPayload[] {
  return doc.endpoints.map((e) => ({
    id: e.id,
    method: e.method,
    path: e.path,
    domain: e.domain,
    description: e.description,
    source: "DRAFT",
    x: e.x,
    y: e.y,
    tables: e.links.map((l) => ({ tableId: l.tableId, access: l.access })),
  }));
}
// Name-keyed view for the "Copiar" prompt/DBML/SQL formatters.
function docToDraftGraph(doc: DraftDoc): DraftGraph {
  const nameById = new Map(doc.tables.map((t) => [t.id, t.name]));
  return {
    tables: doc.tables.map((t) => ({
      name: t.name,
      domain: t.domain,
      description: t.description,
      columns: t.columns.map((c) => ({
        name: c.name,
        type: c.type,
        isPk: c.isPk,
        isFk: c.isFk,
        nullable: c.nullable,
        note: c.note,
      })),
    })),
    relations: doc.relations.flatMap((r) => {
      const fromTable = nameById.get(r.fromTableId);
      const toTable = nameById.get(r.toTableId);
      return fromTable && toTable
        ? [{ fromTable, fromColumn: r.fromColumn, toTable, toColumn: r.toColumn, label: r.label }]
        : [];
    }),
    endpoints: doc.endpoints.map((e) => ({
      method: e.method,
      path: e.path,
      domain: e.domain,
      description: e.description,
      uses: e.links.flatMap((l) => {
        const table = nameById.get(l.tableId);
        return table ? [{ table, access: l.access }] : [];
      }),
    })),
  };
}

export interface DbMapClientHandle {
  open: () => void;
  close: () => void;
  /** Open the side panel directly on the Comments tab (used by the 💬 toolbar button). */
  openComments: () => void;
}

export function DbMapClient({
  tables,
  relations,
  endpoints,
  draft,
  workspaceId,
  embedded = false,
  draftRef,
  onEdit,
  controlRef,
  commentsContent,
  commentsCount = 0,
  onAddComment,
  annotations,
  onPinClick,
  onUpdateComment,
  onRemoveComment,
  boardAnnotations,
}: {
  tables: DbTablePayload[];
  relations: DbRelationPayload[];
  endpoints: EndpointPayload[];
  draft: DraftDoc | null;
  workspaceId: string;
  // When true (embedded inside /plan), fill the parent box instead of 100vh, and skip the
  // canvas top-center tab strip so it doesn't compete with the outer page's tabs.
  embedded?: boolean;
  // Exposes the live edited DraftDoc to a parent (the /plan workspace) so the Submit
  // Feedback flow can ship the user's current canvas edits back to the agent.
  draftRef?: React.MutableRefObject<DraftDoc | null>;
  // Fired the first time the user edits the canvas (rev > 0 → has edits). Lets the
  // parent enable Submit feedback when only DB edits exist (no text annotations).
  onEdit?: () => void;
  // /plan review wiring (mirrors MapClient): imperative handle to open the panel, the Comments
  // tab content + count, and a callback to comment on the selected table/endpoint.
  controlRef?: React.MutableRefObject<DbMapClientHandle | null>;
  commentsContent?: React.ReactNode;
  commentsCount?: number;
  onAddComment?: (excerpt: string) => void;
  // Plan-review annotations: those whose excerpt names a table / table.column / endpoint are
  // drawn ON the canvas as numbered pins + "ANNOTATION · YOU" cards (the rest stay panel-only).
  annotations?: TextAnnotation[];
  onPinClick?: (annotationId: string) => void;
  // When provided (the /plan workspace passes the feedback round's updateComment /
  // removeAnnotation), the on-canvas annotation cards become editable in place — same
  // typing flow as /map board annotations — instead of read-only mirrors of the panel.
  onUpdateComment?: (annotationId: string, comment: string) => void;
  onRemoveComment?: (annotationId: string) => void;
  // Standalone /map mode: persistent board annotations (BoardAnnotation rows). Providing
  // this prop — even [] — switches the canvas-annotation surface from "plan feedback" to
  // "persisted annotations": created from row hover-dots, edited in the card, position remembered.
  boardAnnotations?: BoardAnnotationPayload[];
}) {
  const router = useRouter();
  const [showEndpoints, setShowEndpoints] = useState(true);
  const [selected, setSelected] = useState<DbSelection>(null);
  // Edge selection focuses just the two endpoints of the clicked line; exclusive
  // with node selection (clicking either clears the other).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Hovering a table/endpoint reveals its edges + fades the rest — same effect as a click,
  // without committing the selection (mirrors the roadmap board's hover reveal).
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"details" | "comments">("details");
  const [busy, setBusy] = useState(false);

  // Imperative handle so the /plan toolbar's 💬 button can open this board's Comments tab.
  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = {
      open: () => {
        setPanelOpen(true);
        setPanelTab("details");
      },
      close: () => {
        setPanelOpen(false);
        setPanelTab("details");
      },
      openComments: () => {
        setPanelOpen(true);
        setPanelTab("comments");
      },
    };
    return () => {
      if (controlRef) controlRef.current = null;
    };
  }, [controlRef]);
  // Multi-select filters — empty set means "show all" for that dimension.
  const [domainFilter, setDomainFilter] = useState<Set<string>>(new Set());
  // Semantic-zoom level, lifted out of the React Flow context by <LodReporter/> — drives
  // edge hiding + the far-zoom region summaries.
  const [lod, setLod] = useState<Lod>("full");
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [methodFilter, setMethodFilter] = useState<Set<string>>(new Set());

  // ── The draft document, held locally with an undo/redo history ──
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: draft ?? EMPTY_DOC,
    future: [],
    rev: 0,
    edited: false,
  }));
  const present = history.present;

  const commit = useCallback((producer: (d: DraftDoc) => DraftDoc) => {
    setHistory((h) => {
      const next = producer(h.present);
      if (next === h.present) return h;
      return { past: [...h.past, h.present].slice(-100), present: next, future: [], rev: h.rev + 1, edited: true };
    });
  }, []);
  const silent = useCallback((producer: (d: DraftDoc) => DraftDoc) => {
    setHistory((h) => {
      const next = producer(h.present);
      if (next === h.present) return h;
      return { ...h, present: next };
    });
  }, []);
  const undo = useCallback(
    () =>
      setHistory((h) =>
        h.past.length
          ? {
              past: h.past.slice(0, -1),
              present: h.past[h.past.length - 1],
              future: [h.present, ...h.future],
              rev: h.rev + 1,
              edited: true,
            }
          : h,
      ),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((h) =>
        h.future.length
          ? {
              past: [...h.past, h.present],
              present: h.future[0],
              future: h.future.slice(1),
              rev: h.rev + 1,
              edited: true,
            }
          : h,
      ),
    [],
  );
  const reset = useCallback(
    (doc: DraftDoc) => setHistory((h) => ({ past: [], present: doc, future: [], rev: h.rev + 1, edited: false })),
    [],
  );

  // Boot from localStorage (preferring saved edits for the SAME proposal); afterwards adopt a
  // genuinely new server proposal, or clear when the server draft is gone (approved elsewhere).
  const bootedRef = useRef(false);
  const serverProposedAt = draft?.proposedAt ?? 0;
  useEffect(() => {
    let next: DraftDoc | null = null;
    if (!bootedRef.current) {
      bootedRef.current = true;
      let fromStorage: DraftDoc | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { workspaceId: string; doc: DraftDoc };
          // Restore saved edits ONLY for THIS proposal: same workspace AND same proposedAt as the
          // server's current draft. A features-only plan has no server draft (`draft` is null), so
          // there is nothing to match — loading a leftover draft from an unrelated past proposal
          // would dump stale tables onto a plan that proposed none (and trip the "edited" signal).
          if (
            saved.workspaceId === workspaceId &&
            saved.doc &&
            draft &&
            saved.doc.proposedAt === draft.proposedAt
          )
            fromStorage = saved.doc;
        }
      } catch {
        /* ignore corrupt storage */
      }
      next = fromStorage ?? draft ?? null;
    } else if (draft && draft.proposedAt !== present.proposedAt) {
      next = draft;
    } else if (!draft && (present.tables.length > 0 || present.endpoints.length > 0)) {
      next = EMPTY_DOC;
    }
    if (next) reset(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverProposedAt]);

  // Persist edits so a reload doesn't lose the working draft.
  useEffect(() => {
    try {
      if (present.tables.length > 0 || present.endpoints.length > 0)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ workspaceId, doc: present }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore quota / private mode */
    }
  }, [present, workspaceId]);

  // Mirror the live edited doc into the parent's ref so /plan's Submit Feedback can ship
  // the user's actual canvas edits — not the original proposal.
  useEffect(() => {
    if (draftRef) draftRef.current = present;
  }, [draftRef, present]);

  // Tell the parent "the user has edited" once, on the first GENUINE edit (commit/undo/redo) —
  // NOT on the boot/adopt reset that merely loads the proposal into the board. Gating on
  // `history.edited` (false after any reset) is what keeps Approve enabled when the user only
  // opened the Database tab to look; a real table/column/endpoint edit still enables Submit
  // feedback even with no text annotations yet.
  const editedSignaledRef = useRef(false);
  useEffect(() => {
    if (history.edited && !editedSignaledRef.current) {
      editedSignaledRef.current = true;
      onEdit?.();
    }
  }, [history.edited, onEdit]);

  // ── Combined (real + draft) render data ──
  const draftTables = useMemo(() => draftTablePayloads(present), [present]);
  const draftEndpoints = useMemo(() => draftEndpointPayloads(present), [present]);
  const allTables = useMemo(() => [...tables, ...draftTables], [tables, draftTables]);
  const allEndpoints = useMemo(() => [...endpoints, ...draftEndpoints], [endpoints, draftEndpoints]);

  // Plan-vs-Repo diff: tag each DRAFT node added/modified/unchanged vs. the persisted schema so
  // the canvas can glow it. REVIEW-ONLY — computed only when embedded in /plan; the permanent
  // /map Database tab stays the committed truth (drafts still show, just without diff coloring).
  const emptyDiff = useMemo(() => new Map<string, NodeDiff>(), []);
  const tableDiffs = useMemo(
    () => (embedded ? diffDraftTables(tables, draftTables) : emptyDiff),
    [embedded, tables, draftTables, emptyDiff],
  );
  const endpointDiffs = useMemo(
    () => (embedded ? diffDraftEndpoints(endpoints, draftEndpoints) : emptyDiff),
    [embedded, endpoints, draftEndpoints, emptyDiff],
  );
  const allRelations = useMemo<DbRelationPayload[]>(
    () => [
      ...relations,
      ...present.relations.map((r) => ({
        id: r.id,
        fromTableId: r.fromTableId,
        toTableId: r.toTableId,
        fromColumn: r.fromColumn,
        toColumn: r.toColumn,
        label: r.label,
      })),
    ],
    [relations, present.relations],
  );

  const usageCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of allEndpoints) for (const u of e.tables) m.set(u.tableId, (m.get(u.tableId) ?? 0) + 1);
    return m;
  }, [allEndpoints]);

  const posX = useMemo(() => {
    const m = new Map<string, number>();
    allTables.forEach((t) => m.set(t.id, t.x));
    allEndpoints.forEach((e) => m.set(e.id, e.x));
    return m;
  }, [allTables, allEndpoints]);

  // column → referenced table name per table, so FK rows render "→ users" instead of a type.
  const fkTargets = useMemo(() => {
    const nameById = new Map(allTables.map((t) => [t.id, t.name]));
    const m = new Map<string, Record<string, string>>();
    for (const r of allRelations) {
      const to = nameById.get(r.toTableId);
      if (!to) continue;
      const rec = m.get(r.fromTableId) ?? {};
      rec[r.fromColumn] = to;
      m.set(r.fromTableId, rec);
    }
    return m;
  }, [allRelations, allTables]);

  // ── Canvas annotations — ONE pipeline, two sources ──
  // /plan (feedback): annotations whose excerpt names an entity, read-only on canvas.
  // /map (board annotations): persisted BoardAnnotation rows, editable + movable + deletable.
  const boardMode = boardAnnotations !== undefined;
  const [stored, setStored] = useState<BoardAnnotationPayload[]>(boardAnnotations ?? []);
  useEffect(() => {
    // Live-refresh / navigation re-delivers the server list; adopt it as the new truth.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (boardAnnotations) setStored(boardAnnotations);
  }, [boardAnnotations]);

  const anchorEntities = useMemo(
    () => ({
      tables: allTables.map((t) => ({
        id: t.id,
        name: t.name,
        columns: t.columns.map((c) => c.name),
      })),
      endpoints: allEndpoints.map((e) => ({ id: e.id, method: e.method, path: e.path })),
    }),
    [allTables, allEndpoints],
  );
  const annos = useMemo(() => {
    if (boardMode) {
      const valid = new Set([...allTables.map((t) => t.id), ...allEndpoints.map((e) => e.id)]);
      return stored
        .filter((r) => valid.has(r.targetId))
        .map((r, i) => ({
          id: r.id,
          n: i + 1,
          targetId: r.targetId,
          column: r.columnName,
          text: r.body,
          x: r.x,
          y: r.y,
        }));
    }
    const textById = new Map((annotations ?? []).map((a) => [a.id, a.comment]));
    return anchorAnnotations(annotations ?? [], anchorEntities).map((a) => ({
      id: a.annotationId,
      n: a.n,
      targetId: a.targetId,
      column: a.column,
      text: textById.get(a.annotationId) ?? "",
      x: null as number | null,
      y: null as number | null,
    }));
  }, [boardMode, stored, annotations, anchorEntities, allTables, allEndpoints]);

  const pinsByTarget = useMemo(() => {
    const m = new Map<string, { id: string; n: number; column: string | null }[]>();
    for (const a of annos) {
      const list = m.get(a.targetId) ?? [];
      list.push({ id: a.id, n: a.n, column: a.column });
      m.set(a.targetId, list);
    }
    return m;
  }, [annos]);
  const annoTargetById = useMemo(
    () => new Map(annos.map((a) => [`anno-${a.id}`, a.targetId])),
    [annos],
  );

  // Board-annotation CRUD (fetches are pinned to the browser's workspace via the beacon_ws cookie).
  const addBoardAnno = useCallback(
    async (excerpt: string) => {
      const hit = anchorAnnotations([{ id: "_", excerpt }], anchorEntities)[0];
      if (!hit) return;
      const res = await fetch("/api/board-annotations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetKind: hit.kind,
          targetId: hit.targetId,
          columnName: hit.column ?? undefined,
        }),
      });
      if (res.ok) {
        const row = (await res.json()) as BoardAnnotationPayload;
        setStored((prev) => [...prev, row]);
      }
    },
    [anchorEntities],
  );
  const patchBoardAnno = useCallback((id: string, fields: { body?: string; x?: number; y?: number }) => {
    setStored((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));
    void fetch(`/api/board-annotations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
  }, []);
  const removeBoardAnno = useCallback((id: string) => {
    setStored((prev) => prev.filter((r) => r.id !== id));
    void fetch(`/api/board-annotations/${id}`, { method: "DELETE" });
  }, []);

  const nodeOnComment = boardMode ? addBoardAnno : onAddComment;

  const sides = useCallback(
    (src: string, tgt: string) => {
      const ax = posX.get(src) ?? 0;
      const bx = posX.get(tgt) ?? 0;
      return ax <= bx
        ? { sourceHandle: "sr", targetHandle: "tl" }
        : { sourceHandle: "sl", targetHandle: "tr" };
    },
    [posX],
  );

  // ── React-Flow-owned node list (for smooth dragging), rebuilt from the doc on change ──
  const draftIds = useMemo(
    () => new Set([...present.tables.map((t) => t.id), ...present.endpoints.map((e) => e.id)]),
    [present],
  );
  const realTableIds = useMemo(() => new Set(tables.map((t) => t.id)), [tables]);

  const buildNodes = useCallback((): DbNode[] => {
    const tableNodes: Node<DbTableNodeData>[] = allTables.map((t) => ({
      id: t.id,
      type: "dbTable",
      position: { x: t.x, y: t.y },
      data: {
        name: t.name,
        domain: t.domain,
        columns: t.columns,
        usageCount: usageCount.get(t.id) ?? 0,
        source: t.source,
        rev: history.rev,
        diffStatus: tableDiffs.get(t.id)?.status,
        diffChanges: tableDiffs.get(t.id)?.changes,
        fkTargets: fkTargets.get(t.id),
        pins: pinsByTarget.get(t.id),
        onPinClick,
        onComment: nodeOnComment,
      },
    }));
    const endpointNodes: Node<EndpointNodeData>[] = allEndpoints.map((e) => ({
      id: e.id,
      type: "endpoint",
      position: { x: e.x, y: e.y },
      data: {
        method: e.method,
        path: e.path,
        domain: e.domain,
        source: e.source,
        rev: history.rev,
        diffStatus: endpointDiffs.get(e.id)?.status,
        diffChanges: endpointDiffs.get(e.id)?.changes,
        pins: pinsByTarget.get(e.id),
        onPinClick,
        onComment: nodeOnComment,
      },
    }));
    // Annotation cards float below their target; the pin → card curve carries the number.
    // Multiple cards on one target stagger downward. Board annotations restore their saved x/y;
    // plan cards auto-place (the card is draggable either way — the node-state position map
    // keeps wherever the user parks it through rebuilds).
    const perTarget = new Map<string, number>();
    const tableById = new Map(allTables.map((t) => [t.id, t]));
    const endpointById = new Map(allEndpoints.map((e) => [e.id, e]));
    const annoNodes: Node<AnnotationNodeData>[] = annos.map((a) => {
      const t = tableById.get(a.targetId);
      const e = endpointById.get(a.targetId);
      const baseX = t?.x ?? e?.x ?? 0;
      const baseY = t?.y ?? e?.y ?? 0;
      const height = t ? 38 + t.columns.length * 28 : 42;
      const idx = perTarget.get(a.targetId) ?? 0;
      perTarget.set(a.targetId, idx + 1);
      return {
        id: `anno-${a.id}`,
        type: "annotation",
        position: {
          x: a.x ?? baseX + 26,
          y: a.y ?? baseY + height + 64 + idx * 112,
        },
        data: {
          n: a.n,
          text: a.text,
          annotationId: a.id,
          // Editable in place in BOTH modes when an update path exists; a card click only
          // jumps to the Comments panel when the card is read-only (no editor to focus).
          onClick: boardMode || onUpdateComment ? undefined : onPinClick,
          editable: boardMode || !!onUpdateComment,
          onChangeText: boardMode ? (id, body) => patchBoardAnno(id, { body }) : onUpdateComment,
          onDelete: boardMode ? removeBoardAnno : onRemoveComment,
        },
      };
    });
    return [...tableNodes, ...endpointNodes, ...annoNodes];
  }, [
    allTables,
    allEndpoints,
    usageCount,
    history.rev,
    tableDiffs,
    endpointDiffs,
    fkTargets,
    pinsByTarget,
    annos,
    boardMode,
    onPinClick,
    onUpdateComment,
    onRemoveComment,
    nodeOnComment,
    patchBoardAnno,
    removeBoardAnno,
  ]);

  const [nodes, setNodes, onNodesChange] = useNodesState<DbNode>(buildNodes());
  useEffect(() => {
    setNodes((prev) => {
      const pos = new Map(prev.map((n) => [n.id, n.position]));
      return buildNodes().map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
    });
  }, [buildNodes, setNodes]);

  const persistReal = useCallback((kind: string, id: string, x: number, y: number) => {
    void fetch(`/api/db/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, id, x, y }),
    });
  }, []);

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      const { x, y } = node.position;
      if (node.id.startsWith("anno-")) {
        // Board annotations remember where you parked the card; plan cards are session-local.
        if (boardMode) patchBoardAnno(node.id.slice(5), { x, y });
        return;
      }
      if (draftIds.has(node.id)) {
        // Position lives in the draft doc, but moving a node isn't an undoable edit.
        silent((doc) => {
          if (doc.tables.some((t) => t.id === node.id))
            return { ...doc, tables: doc.tables.map((t) => (t.id === node.id ? { ...t, x, y } : t)) };
          if (doc.endpoints.some((e) => e.id === node.id))
            return {
              ...doc,
              endpoints: doc.endpoints.map((e) => (e.id === node.id ? { ...e, x, y } : e)),
            };
          return doc;
        });
      } else {
        persistReal(node.type === "endpoint" ? "endpoint" : "table", node.id, x, y);
      }
    },
    [draftIds, silent, persistReal, boardMode, patchBoardAnno],
  );

  // ── Edges (real + draft FKs and endpoint→table links) ──
  const fkEdges = useMemo<Edge[]>(
    () =>
      allRelations.map((r) => ({
        id: `fk-${r.id}`,
        source: r.fromTableId,
        target: r.toTableId,
        ...sides(r.fromTableId, r.toTableId),
        type: "deletable",
        label: r.label ?? undefined,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#6b6b6b" },
        style: { stroke: "#6b6b6b" },
      })),
    [allRelations, sides],
  );

  const usageEdges = useMemo<Edge[]>(
    () =>
      allEndpoints.flatMap((e) =>
        e.tables.map((u) => {
          const color = ACCESS_COLOR[u.access] ?? "#5a5a5a";
          return {
            id: `u-${e.id}-${u.tableId}`,
            source: e.id,
            target: u.tableId,
            ...sides(e.id, u.tableId),
            type: "default",
            markerEnd: { type: MarkerType.ArrowClosed, color },
            style: { stroke: color, strokeDasharray: "4 4", opacity: 0.7 },
          } as Edge;
        }),
      ),
    [allEndpoints, sides],
  );

  const baseEdges = useMemo(
    () => (showEndpoints ? [...fkEdges, ...usageEdges] : fkEdges),
    [fkEdges, usageEdges, showEndpoints],
  );

  // Pin → card curves. Outside baseEdges so focus/fade logic never dims them; hidden only
  // when the annotated node itself is filtered out.
  const annoEdges = useMemo<Edge[]>(
    () =>
      annos.map((a) => ({
        id: `annoe-${a.id}`,
        source: a.targetId,
        sourceHandle: `pin-${a.id}`,
        target: `anno-${a.id}`,
        targetHandle: "in",
        type: "default",
        selectable: false,
        zIndex: 30,
        style: { stroke: ANNOTATION_ACCENT, strokeWidth: 1.5, opacity: 0.9 },
      })),
    [annos],
  );

  // Click- AND hover-to-highlight: focusing a NODE (selected wins over hovered) lights its
  // 1-hop neighbours; selecting an EDGE focuses just the two endpoints the line connects.
  // Either fades the rest.
  const focusNodeId = selected?.id ?? hoveredId;
  const focusIds = useMemo(() => {
    if (selectedEdgeId) {
      const e = baseEdges.find((x) => x.id === selectedEdgeId);
      return e ? new Set([e.source, e.target]) : null;
    }
    return focusNodeId ? neighborIds(focusNodeId, baseEdges) : null;
  }, [focusNodeId, selectedEdgeId, baseEdges]);

  // Filter-driven hidden set. Tables fail on domain or source mismatch; endpoints fail
  // on method or source mismatch. Edges touching a hidden node are hidden too.
  const tableMeta = useMemo(
    () => new Map(allTables.map((t) => [t.id, { domain: t.domain, source: t.source }])),
    [allTables],
  );
  const endpointMeta = useMemo(
    () => new Map(allEndpoints.map((e) => [e.id, { method: e.method, source: e.source }])),
    [allEndpoints],
  );
  const hiddenIds = useMemo(() => {
    const out = new Set<string>();
    if (!showEndpoints) for (const id of endpointMeta.keys()) out.add(id);
    for (const [id, meta] of tableMeta) {
      if (domainFilter.size && (!meta.domain || !domainFilter.has(meta.domain))) out.add(id);
      if (sourceFilter.size && !sourceFilter.has(meta.source)) out.add(id);
    }
    for (const [id, meta] of endpointMeta) {
      if (methodFilter.size && !methodFilter.has(meta.method)) out.add(id);
      if (sourceFilter.size && !sourceFilter.has(meta.source)) out.add(id);
    }
    return out;
  }, [showEndpoints, tableMeta, endpointMeta, domainFilter, sourceFilter, methodFilter]);

  // Highlight is for edges — nodes only mildly fade so they're clearly readable as context
  // (otherwise users read "faded" as "missing endpoints"). Edges fade hard since lines were
  // the clutter we wanted to cut.
  const displayNodes = useMemo(() => {
    return nodes.map((n) => {
      // Annotation cards follow their target's visibility and never fade on focus.
      if (n.id.startsWith("anno-")) {
        const target = annoTargetById.get(n.id);
        const hidden = !!target && hiddenIds.has(target);
        return hidden !== !!n.hidden ? { ...n, hidden } : n;
      }
      const hidden = hiddenIds.has(n.id);
      if (!focusIds) return hidden ? { ...n, hidden } : n;
      return {
        ...n,
        hidden,
        style: { ...n.style, opacity: focusIds.has(n.id) ? 1 : 0.45, transition: "opacity 120ms" },
      };
    });
  }, [nodes, hiddenIds, focusIds, annoTargetById]);

  // Domain group-regions (Gestalt common region): tables group by their own domain; each
  // endpoint joins its PRIMARY table's domain (the table it's docked beneath), so the region
  // wraps the whole cluster. Unattached endpoints get their own region. Tracks live drags via
  // the stateful node list.
  const endpointRegionGroup = useMemo(() => {
    const nameById = new Map(allTables.map((t) => [t.id, t.name]));
    const domainById = new Map(allTables.map((t) => [t.id, (t.domain ?? "").trim() || "—"]));
    return new Map(
      allEndpoints.map((e) => {
        const pid = primaryTableFor(
          { id: e.id, method: e.method, path: e.path, uses: e.tables.map((u) => ({ tableId: u.tableId })) },
          nameById,
        );
        return [e.id, pid ? domainById.get(pid)! : UNATTACHED_GROUP] as const;
      }),
    );
  }, [allTables, allEndpoints]);

  const regions = useMemo(() => {
    const items: RegionInput[] = [];
    for (const n of nodes) {
      if (hiddenIds.has(n.id)) continue;
      if (n.type === "dbTable") {
        const d = n.data as DbTableNodeData;
        items.push({
          id: n.id,
          group: (d.domain ?? "").trim() || "—",
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? 280,
          h: n.measured?.height ?? 38 + d.columns.length * 28,
        });
      } else if (n.type === "endpoint") {
        items.push({
          id: n.id,
          group: endpointRegionGroup.get(n.id) ?? UNATTACHED_GROUP,
          x: n.position.x,
          y: n.position.y,
          w: n.measured?.width ?? 240,
          h: n.measured?.height ?? 50,
        });
      }
    }
    return computeGroupRegions(items);
  }, [nodes, hiddenIds, endpointRegionGroup]);

  const displayEdges = useMemo(() => {
    return baseEdges.map((e) => {
      const hidden = hiddenIds.has(e.source) || hiddenIds.has(e.target);
      if (!focusNodeId && !selectedEdgeId) return hidden ? { ...e, hidden } : e;
      const on = selectedEdgeId
        ? e.id === selectedEdgeId
        : focusNodeId
          ? e.source === focusNodeId || e.target === focusNodeId
          : false;
      return on
        ? { ...e, hidden, zIndex: 20, style: { ...e.style, opacity: 1, strokeWidth: 2.5 } }
        : {
            ...e,
            hidden,
            selectable: false,
            label: undefined,
            markerEnd: undefined,
            style: { ...e.style, opacity: 0.08 },
          };
    });
  }, [baseEdges, focusNodeId, selectedEdgeId, hiddenIds]);

  const domainsPresent = useMemo(
    () =>
      Array.from(
        new Set(allTables.map((t) => t.domain).filter((d): d is string => !!d)),
      ).sort(),
    [allTables],
  );
  const sourcesPresent = useMemo(
    () =>
      Array.from(
        new Set([...allTables.map((t) => t.source), ...allEndpoints.map((e) => e.source)]),
      ).sort(),
    [allTables, allEndpoints],
  );
  const methodsPresent = useMemo(
    () => Array.from(new Set(allEndpoints.map((e) => e.method))).sort(),
    [allEndpoints],
  );

  function toggleIn<T>(value: T, set: React.Dispatch<React.SetStateAction<Set<T>>>) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const activeFilterCount =
    (showEndpoints ? 0 : 1) + domainFilter.size + sourceFilter.size + methodFilter.size;
  const clearFilters = useCallback(() => {
    setShowEndpoints(true);
    setDomainFilter(new Set());
    setSourceFilter(new Set());
    setMethodFilter(new Set());
  }, []);

  // ── Drawing a connection: endpoint→table = usage link; draft-table→table = FK ──
  const onConnect = useCallback(
    (c: Connection) => {
      const { source, target } = c;
      if (!source || !target || source === target) return;
      commit((doc) => {
        const targetIsTable = doc.tables.some((t) => t.id === target) || realTableIds.has(target);
        if (!targetIsTable) return doc;
        const ep = doc.endpoints.find((e) => e.id === source);
        if (ep) {
          if (ep.links.some((l) => l.tableId === target)) return doc;
          return {
            ...doc,
            endpoints: doc.endpoints.map((e) =>
              e.id === source
                ? { ...e, links: [...e.links, { tableId: target, access: accessForMethod(e.method) }] }
                : e,
            ),
          };
        }
        const srcTbl = doc.tables.find((t) => t.id === source);
        if (srcTbl) {
          if (doc.relations.some((r) => r.fromTableId === source && r.toTableId === target))
            return doc;
          return {
            ...doc,
            relations: [
              ...doc.relations,
              {
                id: crypto.randomUUID(),
                fromTableId: source,
                toTableId: target,
                fromColumn: "fk",
                toColumn: "id",
                label: null,
              },
            ],
          };
        }
        return doc;
      });
    },
    [commit, realTableIds],
  );

  // ── Inline edits from draft nodes (local, undoable) ──
  const dbEdit = useMemo<DbEditApi>(
    () => ({
      patchEndpoint: (id, fields) =>
        commit((doc) => ({
          ...doc,
          endpoints: doc.endpoints.map((e) => (e.id === id ? { ...e, ...fields } : e)),
        })),
      deleteEndpoint: (id) =>
        commit((doc) => ({ ...doc, endpoints: doc.endpoints.filter((e) => e.id !== id) })),
      patchTable: (id, fields) =>
        commit((doc) => ({
          ...doc,
          tables: doc.tables.map((t) => (t.id === id ? { ...t, ...fields } : t)),
        })),
      deleteTable: (id) =>
        commit((doc) => ({
          ...doc,
          tables: doc.tables.filter((t) => t.id !== id),
          relations: doc.relations.filter((r) => r.fromTableId !== id && r.toTableId !== id),
          endpoints: doc.endpoints.map((e) => ({
            ...e,
            links: e.links.filter((l) => l.tableId !== id),
          })),
        })),
      deleteRealEndpoint: (id) => {
        void fetch(`/api/endpoints/${id}`, { method: "DELETE" }).then((r) => {
          if (r.ok) router.refresh();
        });
      },
    }),
    [commit, router],
  );

  // ── Keyboard undo/redo (ignored while typing in a node field) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ── Approve (persist to real schema + signal Claude) / Discard ──
  const approve = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/draft/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(present),
      });
      if (res.ok) {
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        reset(EMPTY_DOC);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [present, reset, router]);

  const discard = useCallback(async () => {
    setBusy(true);
    try {
      await fetch("/api/draft", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    reset(EMPTY_DOC);
    router.refresh();
    setBusy(false);
  }, [reset, router]);

  const draftGraph = useMemo(() => docToDraftGraph(present), [present]);
  const hasDraft = present.tables.length > 0 || present.endpoints.length > 0;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <DbEditContext.Provider value={dbEdit}>
      <div className={cn("canvas-dots relative w-full", embedded ? "h-full" : "h-screen")}>
        <ReactFlow
          nodes={displayNodes}
          edges={
            // Far zoom: hide edges entirely — noise between invisible cards.
            lod === "far"
              ? [...displayEdges, ...annoEdges].map((e) => ({ ...e, hidden: true }))
              : [...displayEdges, ...annoEdges.map((e) => ({ ...e, hidden: hiddenIds.has(e.source) }))]
          }
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionMode={ConnectionMode.Loose}
          connectionLineStyle={{
            stroke: "var(--accent-2,#ff7a45)",
            strokeWidth: 1.5,
            strokeDasharray: "4 4",
          }}
          onNodesChange={onNodesChange}
          onConnect={onConnect}
          onNodeMouseEnter={(_, node) => {
            if (node.type !== "annotation") setHoveredId(node.id);
          }}
          onNodeMouseLeave={() => setHoveredId(null)}
          onNodeClick={(_, node) => {
            if (node.type === "annotation") {
              onPinClick?.((node.data as AnnotationNodeData).annotationId);
              return;
            }
            const kind = node.type === "endpoint" ? "endpoint" : "table";
            setSelected({ id: node.id, kind });
            setSelectedEdgeId(null);
            setPanelOpen(true);
            setPanelTab("details"); // selecting a node always lands on Details
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            setSelected(null);
          }}
          onPaneClick={() => {
            setSelected(null);
            setSelectedEdgeId(null);
          }}
          onNodeDragStop={onNodeDragStop}
          onEdgesDelete={(removed) => {
            // FK relations carry id prefix `fk-`; endpoint→table usage links use `u-`.
            // Usage links live inside the doc — let onNodesChange's selection handle it
            // since the user usually deletes via the endpoint node UI. Real FK relations
            // get persisted deletion.
            for (const e of removed) {
              if (e.id.startsWith("fk-")) {
                const realId = e.id.slice(3);
                void fetch(`/api/db/relations/${realId}`, { method: "DELETE" });
              }
            }
          }}
          onNodesDelete={(removed) => {
            for (const n of removed) {
              // draft tables/endpoints are managed by the local doc + undo history; skip
              // here so the user uses the in-card delete button for those. Annotation cards
              // are removed from the Comments panel, not the canvas.
              if (n.id.startsWith("anno-") || draftIds.has(n.id)) continue;
              if (n.type === "endpoint") {
                void fetch(`/api/endpoints/${n.id}`, { method: "DELETE" });
              } else if (n.type === "dbTable") {
                void fetch(`/api/db/tables/${n.id}`, { method: "DELETE" });
              }
            }
          }}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode="dark"
          fitView
          minZoom={0.15}
          // Scroll pans the board; hold ⌘/Ctrl while scrolling to zoom (trackpad pinch still zooms).
          panOnScroll
          zoomActivationKeyCode={["Meta", "Control"]}
          proOptions={{ hideAttribution: true }}
        >
          {/* Labeled domain containers behind the tables — pan/zoom with the canvas. */}
          <GroupRegions regions={regions} tone="category" lod={lod} />
          <LodReporter onLod={setLod} />
          <Controls
            position="bottom-right"
            className="!overflow-hidden !rounded-xl !border !border-white/10 [&_button]:!border-white/10 [&_button]:!bg-card/70 [&_button]:!text-foreground [&_button]:!backdrop-blur"
          />
          {!embedded && (
            <MiniMap
              pannable
              zoomable
              position="bottom-left"
              style={{ width: 140, height: 90 }}
              className="!rounded-xl !border !border-white/10 !bg-card/50 !backdrop-blur"
              nodeColor="#555"
            />
          )}

          {!embedded && (
            <Panel position="top-center" className="glass rounded-full px-1 py-0.5">
              <CanvasTabs
                active="DATABASE"
                tabs={[
                  { value: "ROADMAP", label: "Roadmap", href: "/map?view=ROADMAP" },
                  { value: "ARCHITECTURE", label: "Architecture", href: "/map?view=ARCHITECTURE" },
                  { value: "FILES", label: "Files", href: "/map?view=FILES" },
                  { value: "DATABASE", label: "Database", href: "/map?view=DATABASE" },
                ]}
              />
            </Panel>
          )}

          <Panel
            position="top-right"
            className={cn(
              "flex items-center gap-1 transition-[margin] duration-200",
              panelOpen && "!mr-[332px]",
              embedded && "hidden",
            )}
          >
            <button
              type="button"
              title="Arrange board — pack tables + endpoints side by side"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await fetch("/api/db/arrange", { method: "POST" });
                  router.refresh();
                } finally {
                  setBusy(false);
                }
              }}
              className="glass flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              <LayoutGrid className="size-4" />
            </button>
            <CanvasPopover
              title="Filters"
              trigger={(open, toggle) => (
                <button
                  type="button"
                  onClick={toggle}
                  title="Filters"
                  className={cn(
                    "glass relative flex size-8 items-center justify-center rounded-lg transition-colors",
                    open || activeFilterCount > 0
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <SlidersHorizontal className="size-4" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-2,#ff7a45)] px-1 text-[9px] font-semibold text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
              )}
            >
              <PopoverSection title="Show">
                <Chip tone="accent" on={showEndpoints} onClick={() => setShowEndpoints((s) => !s)}>
                  endpoints
                </Chip>
              </PopoverSection>
              {domainsPresent.length > 0 && (
                <PopoverSection title="Domain">
                  {domainsPresent.map((d) => (
                    <Chip
                      key={d}
                      on={domainFilter.has(d)}
                      onClick={() => toggleIn(d, setDomainFilter)}
                    >
                      {d}
                    </Chip>
                  ))}
                </PopoverSection>
              )}
              {methodsPresent.length > 0 && (
                <PopoverSection title="Method">
                  {methodsPresent.map((m) => (
                    <Chip
                      key={m}
                      on={methodFilter.has(m)}
                      onClick={() => toggleIn(m, setMethodFilter)}
                    >
                      {m}
                    </Chip>
                  ))}
                </PopoverSection>
              )}
              {sourcesPresent.length > 0 && (
                <PopoverSection title="Source">
                  {sourcesPresent.map((s) => (
                    <Chip
                      key={s}
                      on={sourceFilter.has(s)}
                      onClick={() => toggleIn(s, setSourceFilter)}
                    >
                      {s.toLowerCase()}
                    </Chip>
                  ))}
                </PopoverSection>
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-1 w-full rounded-md border border-white/10 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  clear filters
                </button>
              )}
            </CanvasPopover>

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
                  <span
                    aria-hidden
                    className="inline-block h-px w-6 bg-[#6b6b6b]"
                  />
                  <span>foreign key · drag from a table handle</span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-0 w-6 border-t border-dashed"
                    style={{ borderColor: "#4ea1ff" }}
                  />
                  <span>endpoint read · GET / POST / etc</span>
                </li>
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-0 w-6 border-t border-dashed"
                    style={{ borderColor: "#ffb86b" }}
                  />
                  <span>endpoint write</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="inline-block rounded border border-dashed border-sky-400/50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                    draft
                  </span>
                  <span>agent-proposed · approve to persist</span>
                </li>
              </ul>
            </CanvasPopover>

            {!panelOpen && (
              <button
                onClick={() => setPanelOpen(true)}
                title="Show panel"
                className="glass flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              >
                <PanelRight className="size-4" />
              </button>
            )}
          </Panel>

          {hasDraft && (
            <Panel
              position="bottom-center"
              className="glass flex items-center gap-1 rounded-xl p-1.5"
            >
              <button
                onClick={undo}
                disabled={!canUndo}
                title="Undo (⌘Z)"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Undo2 className="size-3.5" /> undo
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                title="Redo (⇧⌘Z)"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Redo2 className="size-3.5" /> redo
              </button>
              {/* In /plan the top plan bar owns the verdict (Approve / Discard) and any DB-design
                  comments flow back as plan feedback — that's the intended flow — so the
                  draft-level verdict buttons are redundant there. Keep them only on the
                  standalone /map board, where there's no plan bar. undo/redo stay in both. */}
              {!embedded && (
                <>
                  <span className="mx-1 h-4 w-px bg-white/10" />
                  <button
                    onClick={discard}
                    disabled={busy}
                    title="Discard draft"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40"
                  >
                    <Trash2 className="size-3.5" /> discard
                  </button>
                  <button
                    onClick={approve}
                    disabled={busy}
                    title="Approve and persist to the schema"
                    className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
                  >
                    <Check className="size-3.5" /> approve draft
                  </button>
                </>
              )}
            </Panel>
          )}

        </ReactFlow>

        {panelOpen && (
          <DbDetailSidebar
            selected={selected}
            tables={allTables}
            relations={allRelations}
            endpoints={allEndpoints}
            draftGraph={draftGraph}
            onClose={() => {
              setPanelOpen(false);
              setPanelTab("details");
            }}
            commentsContent={commentsContent}
            commentsCount={commentsCount}
            activeTab={panelTab}
            onTabChange={setPanelTab}
            onAddComment={nodeOnComment}
            topOffset={embedded ? 64 : undefined}
          />
        )}
      </div>
    </DbEditContext.Provider>
  );
}
