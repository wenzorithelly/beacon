import { layeredLayout } from "@/lib/layered-layout";
import type { Lesson, LessonQuestion } from "@/lib/lesson-types";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";
import type { LessonTableData } from "@/components/graph/lesson-table-node";

// Adapt a Lesson into the payloads the EXISTING architecture canvas (MapClient) renders — concept
// cards (arch nodes) AND annotated table cards on the SAME board, joined by the same labeled,
// bowing edges. We reuse that board wholesale (zoom/pan/minimap, handles, edges, detail sidebar)
// rather than a bespoke one. Tables stay file-based + read-only; nothing leaks into the real /db tab.

export interface LessonTableBoardNode {
  id: string;
  x: number;
  y: number;
  data: LessonTableData;
}

export function lessonToBoard(lesson: Lesson): {
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  tableNodes: LessonTableBoardNode[];
} {
  const tables = lesson.tables ?? [];
  const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

  // FK edges: a column with fkTo links its table → the referenced table.
  const fkEdges = tables.flatMap((t) =>
    t.columns
      .filter((c) => c.fkTo && tableNameById.has(c.fkTo))
      .map((c) => ({ id: `fk-${t.id}-${c.name}`, fromId: t.id, toId: c.fkTo as string })),
  );

  // Layered (dependency-flow) layout over concepts AND tables together; edges reversed so the
  // source sits upstream (left). Generous spacing → no overlap; the user can drag to declutter.
  const pos = layeredLayout(
    [
      ...lesson.nodes.map((n) => ({ id: n.id, group: n.group ?? "—" })),
      ...tables.map((t) => ({ id: t.id, group: t.group ?? t.domain ?? "—" })),
    ],
    [
      ...lesson.edges.map((e) => ({ fromId: e.toId, toId: e.fromId })),
      ...fkEdges.map((e) => ({ fromId: e.toId, toId: e.fromId })),
    ],
  );

  const qaByNode = new Map<string, LessonQuestion[]>();
  for (const q of lesson.questions) {
    if (q.anchor.kind === "node") {
      const arr = qaByNode.get(q.anchor.nodeId) ?? [];
      arr.push(q);
      qaByNode.set(q.anchor.nodeId, arr);
    }
  }

  const nodes: MapNodePayload[] = lesson.nodes.map((n) => {
    const p = pos.get(n.id) ?? { x: n.x, y: n.y };
    const qa = qaByNode.get(n.id) ?? [];
    const qaMd = qa.length
      ? "\n\n**Q&A**\n" +
        qa.map((q) => `\n_${q.question}_\n${q.answer ?? "_(waiting for the agent…)_"}`).join("\n")
      : "";
    const plain = `${n.detail || ""}${qaMd}`.trim();
    return {
      id: n.id,
      view: "ARCHITECTURE",
      kind: "FEATURE",
      cluster: n.group ?? null,
      layer: null,
      title: n.title,
      role: n.summary || null,
      plain: plain || null,
      status: "KEEP",
      priority: 2,
      x: p.x,
      y: p.y,
      source: "MANUAL",
      sourceRef: null,
      parentId: null,
      isCriterion: false,
      files: n.files,
      bugFlags: [],
    };
  });

  const tableNodes: LessonTableBoardNode[] = tables.map((t) => {
    const p = pos.get(t.id) ?? { x: 0, y: 0 };
    return {
      id: t.id,
      x: p.x,
      y: p.y,
      data: {
        name: t.name,
        domain: t.domain ?? null,
        note: t.note,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          isPk: c.isPk,
          isFk: c.isFk,
          note: c.note,
          // Resolve the FK target id → its table name for the "→ table" hint.
          fkTo: c.fkTo ? tableNameById.get(c.fkTo) ?? c.fkTo : undefined,
        })),
        sample: t.sample,
      },
    };
  });

  const edges: MapEdgePayload[] = [
    ...lesson.edges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      kind: "RELATES",
      label: e.verb,
      sourceHandle: null,
      targetHandle: null,
    })),
    ...fkEdges.map((e) => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      kind: "RELATES",
      label: "FK",
      sourceHandle: null,
      targetHandle: null,
    })),
  ];

  return { nodes, edges, tableNodes };
}
