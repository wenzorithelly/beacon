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
  /** The banding group the layout placed this table under — lets the canvas draw its labeled
   *  region box with the same key. */
  group: string;
  data: LessonTableData;
}

// Estimated rendered height (px) of a COLLAPSED lesson-table card (w-[270px]): header + table
// note + up to 5 column rows (name line + wrapped note lines) + the expand footer. Mirrors
// components/graph/lesson-table-node.tsx; feeds the layered layout so a tall schema card
// reserves its real vertical space instead of one fixed ROW_H row. Overshooting only adds
// whitespace — undershooting stacks the next band on top of the card.
export function lessonTableCardH(t: Pick<LessonTableData, "note" | "columns" | "sample">): number {
  const lines = (s: string | undefined, perLine: number) => (s ? Math.ceil(s.length / perLine) : 0);
  const shown = (t.columns ?? []).slice(0, 5);
  const colH = shown.reduce((sum, c) => sum + 25 + lines(c.note, 42) * 14, 0);
  const footer = (t.columns ?? []).length > shown.length || (t.sample?.length ?? 0) > 0 ? 28 : 0;
  return 36 + (t.note ? 12 + lines(t.note, 45) * 15 : 0) + colH + footer;
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
  // source sits upstream (left). Tables pass their estimated card height (+ row gap) as the
  // pitch, so a tall schema card reserves real space instead of one 150px row.
  const pos = layeredLayout(
    [
      ...lesson.nodes.map((n) => ({ id: n.id, group: n.group ?? "—" })),
      ...tables.map((t) => ({
        id: t.id,
        group: t.group ?? t.domain ?? "—",
        h: lessonTableCardH(t) + 30,
      })),
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
      group: t.group ?? t.domain ?? "—",
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
