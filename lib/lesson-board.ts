import { layeredLayout } from "@/lib/layered-layout";
import type { Lesson, LessonQuestion } from "@/lib/lesson-types";
import type { MapEdgePayload, MapNodePayload } from "@/components/graph/types";

// Adapt a Lesson into the payloads the EXISTING architecture canvas (MapClient) renders. We reuse
// that board wholesale — zoom/pan/mouse-mode controls, hidden-until-hover handles, node measurement,
// edges, the detail sidebar, and the "Ask the agent" hook — instead of a bespoke board. The lesson's
// concept nodes become ARCHITECTURE cards; its verb-labeled edges become RELATES links; node-anchored
// Q&A is folded into each card's `plain` so the detail sidebar shows the explanation + answers.
export function lessonToBoard(lesson: Lesson): { nodes: MapNodePayload[]; edges: MapEdgePayload[] } {
  // Layered (dependency-flow) positions — edges reversed so the source sits upstream (left). Generous
  // spacing → no overlap. The user can still drag to declutter on the canvas.
  const pos = layeredLayout(
    lesson.nodes.map((n) => ({ id: n.id, group: n.group ?? "—" })),
    lesson.edges.map((e) => ({ fromId: e.toId, toId: e.fromId })),
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

  const edges: MapEdgePayload[] = lesson.edges.map((e) => ({
    id: e.id,
    fromId: e.fromId,
    toId: e.toId,
    kind: "RELATES",
    label: e.verb,
    sourceHandle: null,
    targetHandle: null,
  }));

  return { nodes, edges };
}
