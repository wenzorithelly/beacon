"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  MarkerType,
  ReactFlow,
  useInternalNode,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import { HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FourDotHandles } from "@/components/graph/handles";
import { getFloatingEdgeParams } from "@/components/graph/floating-edge";
import { Inline, MarkdownView } from "@/components/plan/markdown-view";
import type { Lesson, LessonNode, LessonQuestion } from "@/lib/lesson-types";

// The concept map on /learn: the agent's curated boxes joined by verb-labeled arrows. Nodes show a
// one-line summary; clicking one opens a drawer with the fuller explanation, its clickable files,
// its Q&A, and an "Ask about this" composer. Positions come straight from the lesson and are NOT
// draggable — a learning board's value is a STABLE spatial layout you re-find each visit (the
// method-of-loci / Data Mountain principle), so it's laid out once and frozen.

interface LessonNodeData extends Record<string, unknown> {
  title: string;
  summary: string;
  fileCount: number;
  pending: number; // questions queued this round
  answered: number; // questions the agent has answered
  selected: boolean;
  dimmed: boolean; // set by the walkthrough (Phase 5) to spotlight one node at a time
  onAsk: (id: string) => void;
}

function LessonNodeCard({ id, data }: NodeProps<Node<LessonNodeData>>) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur transition-opacity",
        data.selected ? "border-[var(--accent-2,#ff7a45)]/70 ring-1 ring-[var(--accent-2,#ff7a45)]/40" : "border-white/12",
        data.dimmed && "opacity-25",
      )}
    >
      <FourDotHandles />
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-semibold leading-tight text-foreground">{data.title}</div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onAsk(id);
          }}
          title="Ask about this"
          className="nodrag shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-[var(--accent-2,#ff7a45)]/15 hover:text-[var(--accent-2,#ff7a45)]"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </div>
      {data.summary && <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{data.summary}</div>}
      {(data.fileCount > 0 || data.pending > 0 || data.answered > 0) && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/80">
          {data.fileCount > 0 && <span>{data.fileCount} file{data.fileCount === 1 ? "" : "s"}</span>}
          {data.answered > 0 && <span className="text-emerald-300/90">{data.answered} answered</span>}
          {data.pending > 0 && <span className="text-[var(--accent-2,#ff7a45)]">{data.pending} pending</span>}
        </div>
      )}
    </div>
  );
}

// Floating, always-labeled arrow (the verb). Routes to whichever sides face each other.
function LessonEdge(props: EdgeProps) {
  const s = useInternalNode(props.source);
  const t = useInternalNode(props.target);
  const f = s && t ? getFloatingEdgeParams(s, t) : null;
  const [path, labelX, labelY] = getBezierPath(
    f
      ? { sourceX: f.sx, sourceY: f.sy, sourcePosition: f.sourcePos, targetX: f.tx, targetY: f.ty, targetPosition: f.targetPos }
      : {
          sourceX: props.sourceX,
          sourceY: props.sourceY,
          sourcePosition: props.sourcePosition,
          targetX: props.targetX,
          targetY: props.targetY,
          targetPosition: props.targetPosition,
        },
  );
  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />
      {props.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              fontSize: 10,
              color: "#cfcfcf",
              background: "#161616",
              padding: "1px 5px",
              borderRadius: 4,
              pointerEvents: "none",
              zIndex: 1000,
            }}
          >
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { lesson: LessonNodeCard };
const edgeTypes = { lesson: LessonEdge };

export interface LessonMapHandle {
  fitView: () => void;
}

export function LessonMap({
  lesson,
  onAskNode,
  pendingByNode,
  /** Walkthrough spotlight (Phase 5): node ids to keep lit; null = all lit. */
  focusIds = null,
}: {
  lesson: Lesson;
  onAskNode: (nodeId: string, question: string) => void;
  pendingByNode: Map<string, number>;
  focusIds?: Set<string> | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flowRef = useRef<ReactFlowInstance<Node<LessonNodeData>, Edge> | null>(null);

  const answeredByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of lesson.questions) {
      if (q.anchor.kind === "node" && q.answer) m.set(q.anchor.nodeId, (m.get(q.anchor.nodeId) ?? 0) + 1);
    }
    return m;
  }, [lesson.questions]);

  const askNode = useCallback((id: string) => setSelectedId(id), []);

  const nodes: Node<LessonNodeData>[] = useMemo(
    () =>
      lesson.nodes.map((n) => ({
        id: n.id,
        type: "lesson",
        position: { x: n.x, y: n.y },
        data: {
          title: n.title,
          summary: n.summary,
          fileCount: n.files.length,
          pending: pendingByNode.get(n.id) ?? 0,
          answered: answeredByNode.get(n.id) ?? 0,
          selected: selectedId === n.id,
          dimmed: focusIds ? !focusIds.has(n.id) : false,
          onAsk: askNode,
        },
      })),
    [lesson.nodes, pendingByNode, answeredByNode, selectedId, focusIds, askNode],
  );

  const edges: Edge[] = useMemo(
    () =>
      lesson.edges.map((e) => ({
        id: e.id,
        source: e.fromId,
        target: e.toId,
        type: "lesson",
        label: e.verb,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#9aa0a6", width: 16, height: 16 },
        style: {
          stroke: "#6b7280",
          strokeWidth: 1.5,
          opacity: focusIds && !(focusIds.has(e.fromId) && focusIds.has(e.toId)) ? 0.15 : 1,
        },
      })),
    [lesson.edges, focusIds],
  );

  const selectedNode = selectedId ? lesson.nodes.find((n) => n.id === selectedId) ?? null : null;

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        panOnScroll
        zoomActivationKeyCode={["Meta", "Control"]}
        proOptions={{ hideAttribution: true }}
        onInit={(i) => {
          flowRef.current = i as unknown as ReactFlowInstance<Node<LessonNodeData>, Edge>;
        }}
        onNodeClick={(_, n) => setSelectedId(n.id)}
        onPaneClick={() => setSelectedId(null)}
      />
      {selectedNode && (
        <NodeDrawer
          node={selectedNode}
          questions={lesson.questions.filter((q) => q.anchor.kind === "node" && q.anchor.nodeId === selectedNode.id)}
          pending={pendingByNode.get(selectedNode.id) ?? 0}
          onAsk={(q) => onAskNode(selectedNode.id, q)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function NodeDrawer({
  node,
  questions,
  pending,
  onAsk,
  onClose,
}: {
  node: LessonNode;
  questions: LessonQuestion[];
  pending: number;
  onAsk: (q: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    if (draft.trim()) onAsk(draft.trim());
    setDraft("");
  };
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-80 flex-col border-l border-white/10 bg-card/95 backdrop-blur">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3.5 py-3">
        <div className="text-sm font-semibold text-foreground">{node.title}</div>
        <button onClick={onClose} title="Close" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {node.summary && <p className="text-[12px] text-muted-foreground">{node.summary}</p>}
        {node.detail && (
          <div className="text-[12px] leading-relaxed text-foreground/85">
            <MarkdownView markdown={node.detail} variant="compact" />
          </div>
        )}
        {node.files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {node.files.map((f) => (
              <span key={f}>
                <Inline text={`\`${f}\``} />
              </span>
            ))}
          </div>
        )}
        {questions.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Q&amp;A</div>
            {questions.map((q) => (
              <div key={q.id} className="rounded-md border border-white/10 bg-background/40 p-2">
                <div className="text-[12px] font-medium text-foreground">{q.question}</div>
                {q.answer ? (
                  <div className="mt-1 text-[12px] leading-relaxed text-foreground/85">
                    <MarkdownView markdown={q.answer} variant="compact" />
                  </div>
                ) : (
                  <div className="mt-1 text-[11px] text-muted-foreground/70">waiting for the agent…</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-white/10 p-2.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the agent about this node… (Enter)"
          rows={2}
          className="w-full resize-none rounded border border-white/10 bg-background px-2 py-1 text-[12px] outline-none focus:border-[var(--accent-2,#ff7a45)]/40"
        />
        {pending > 0 && (
          <div className="mt-1 text-[10px] text-[var(--accent-2,#ff7a45)]">
            {pending} question{pending === 1 ? "" : "s"} queued — Send from the top bar
          </div>
        )}
      </div>
    </div>
  );
}
