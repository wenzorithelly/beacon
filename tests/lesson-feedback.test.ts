import { describe, expect, it } from "bun:test";
import { renderQuestions } from "@/lib/lesson-feedback";
import type { LessonQuestion } from "@/lib/lesson-types";

const q = (over: Partial<LessonQuestion> & Pick<LessonQuestion, "id" | "anchor" | "question">): LessonQuestion => ({
  askedAt: 1,
  ...over,
});

describe("renderQuestions", () => {
  it("returns an empty string when there are no real questions", () => {
    expect(renderQuestions([])).toBe("");
    expect(renderQuestions([q({ id: "a", anchor: { kind: "overall" }, question: "   " })])).toBe("");
  });

  it("groups overall / node / passage and tags each with [q:ID] for answer-by-id", () => {
    const out = renderQuestions(
      [
        q({ id: "o1", anchor: { kind: "overall" }, question: "what is this lesson about?" }),
        q({ id: "n1", anchor: { kind: "node", nodeId: "node-a" }, question: "why does it block?" }),
        q({ id: "t1", anchor: { kind: "text", excerpt: "the sync is decoupled" }, question: "decoupled how?" }),
      ],
      new Map([["node-a", "ERP Sync Engine"]]),
    );
    expect(out).toContain("## Questions from the user");
    expect(out).toContain("### Overall");
    expect(out).toContain("[q:o1] what is this lesson about?");
    expect(out).toContain('### About "ERP Sync Engine"'); // node title resolved
    expect(out).toContain("[q:n1] why does it block?");
    expect(out).toContain("> the sync is decoupled"); // passage quoted
    expect(out).toContain("[q:t1] decoupled how?");
    expect(out).toContain("answers: [{ questionId, answer }]"); // instructs the agent
  });

  it("falls back to the node id when no title is known", () => {
    const out = renderQuestions([q({ id: "n1", anchor: { kind: "node", nodeId: "node-x" }, question: "?" })]);
    expect(out).toContain('### About "node-x"');
  });
});
