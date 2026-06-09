import { describe, expect, it } from "bun:test";
import { renderQuestions, renderAnnotationFeedback } from "@/lib/plan-annotations-store";

describe("renderQuestions", () => {
  it("renders node questions as a feedback section", () => {
    const out = renderQuestions([
      { target: "table: users", question: "why a separate table?" },
      { target: "endpoint: DELETE /posts/{id}", question: "is this soft-delete?" },
    ]);
    expect(out).toContain("## Questions to answer before approving");
    expect(out).toContain("- **table: users** — why a separate table?");
    expect(out).toContain("- **endpoint: DELETE /posts/{id}** — is this soft-delete?");
  });

  it("returns empty string when there are no non-blank questions", () => {
    expect(renderQuestions([])).toBe("");
    expect(renderQuestions([{ target: "x", question: "   " }])).toBe("");
  });
});

describe("renderAnnotationFeedback with questions", () => {
  it("appends the questions section to the feedback bundle", () => {
    const fb = renderAnnotationFeedback({
      annotations: [],
      globalComment: "looks good overall",
      submitted: true,
      questions: [{ target: "feature: Risk Badges", question: "how are rules chosen?" }],
    });
    expect(fb).toContain("looks good overall");
    expect(fb).toContain("## Questions to answer before approving");
    expect(fb).toContain("how are rules chosen?");
  });

  it("omits the questions section entirely when there are none", () => {
    const fb = renderAnnotationFeedback({
      annotations: [],
      globalComment: "fine",
      submitted: true,
      questions: [],
    });
    expect(fb).not.toContain("Questions to answer");
  });
});
