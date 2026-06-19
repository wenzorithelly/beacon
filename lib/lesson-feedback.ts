import type { LessonQuestion } from "@/lib/lesson-types";

// Render the user's submitted questions into the markdown the blocking beacon_explain tool returns
// to the terminal session — the lesson analog of renderFeedback (lib/annotations.ts). Each question
// carries its [q:ID] so the agent answers it by id (re-pushing with `answers: [{questionId,answer}]`)
// instead of fuzzy-matching prose. Grouped overall → per-node → per-passage so related questions
// read together. `nodeTitleById` resolves node anchors to a readable title.

export function renderQuestions(
  questions: LessonQuestion[],
  nodeTitleById: Map<string, string> = new Map(),
): string {
  const open = questions.filter((q) => q.question.trim());
  if (!open.length) return "";

  const overall = open.filter((q) => q.anchor.kind === "overall");
  const nodeQs = open.filter((q) => q.anchor.kind === "node");
  const textQs = open.filter((q) => q.anchor.kind === "text");

  const parts: string[] = [
    "## Questions from the user",
    "",
    "Answer each one, then call `beacon_explain` again with the SAME lesson plus " +
      "`answers: [{ questionId, answer }]` (keyed by the `[q:ID]` below). Expand the narrative or " +
      "add nodes where it helps. Keep answering in this loop until the user saves the lesson.",
  ];

  if (overall.length) {
    parts.push("", "### Overall");
    for (const q of overall) parts.push(`- [q:${q.id}] ${q.question.trim()}`);
  }

  if (nodeQs.length) {
    // Group node questions under their node's title.
    const byNode = new Map<string, LessonQuestion[]>();
    for (const q of nodeQs) {
      if (q.anchor.kind !== "node") continue;
      const key = q.anchor.nodeId;
      (byNode.get(key) ?? byNode.set(key, []).get(key)!).push(q);
    }
    for (const [nodeId, qs] of byNode) {
      const title = nodeTitleById.get(nodeId) ?? nodeId;
      parts.push("", `### About "${title}"`);
      for (const q of qs) parts.push(`- [q:${q.id}] ${q.question.trim()}`);
    }
  }

  if (textQs.length) {
    parts.push("", "### About specific passages");
    for (const q of textQs) {
      if (q.anchor.kind !== "text") continue;
      const quoted = q.anchor.excerpt
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      parts.push("", quoted, `- [q:${q.id}] ${q.question.trim()}`);
    }
  }

  return parts.join("\n").trim();
}
