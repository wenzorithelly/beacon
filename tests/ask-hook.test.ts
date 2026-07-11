import { describe, expect, it } from "bun:test";
import { buildAskFromEvent } from "@/lib/ask-store";

// bin/ask.ts is thin glue over buildAskFromEvent (event → ask payload) — verify the mapping that
// decides what gets surfaced, and what falls through to the terminal.

describe("buildAskFromEvent", () => {
  it("maps a PreToolUse AskUserQuestion to a question (first question)", () => {
    const ask = buildAskFromEvent({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            header: "DB",
            question: "Which database?",
            multiSelect: false,
            options: [
              { label: "Postgres", description: "relational" },
              { label: "SQLite" },
            ],
          },
        ],
      },
    });
    expect(ask?.kind).toBe("question");
    expect(ask?.kind === "question" && ask.question.question).toBe("Which database?");
    expect(ask?.kind === "question" && ask.question.options.map((o) => o.label)).toEqual([
      "Postgres",
      "SQLite",
    ]);
  });

  it("captures a per-option `preview` visual aid (dropping it left Beacon's card blank)", () => {
    const ask = buildAskFromEvent({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            header: "Grid snap",
            question: "What should snapping do?",
            multiSelect: false,
            options: [
              { label: "Both", description: "wrap + drag", preview: "grid-wrap + draggable\n  ✂ 2 lines hidden" },
              { label: "Neither" },
            ],
          },
        ],
      },
    });
    if (ask?.kind !== "question") throw new Error("expected a question ask");
    expect(ask.question.options[0].preview).toBe("grid-wrap + draggable\n  ✂ 2 lines hidden");
    expect(ask.question.options[1].preview).toBeUndefined(); // no preview ⇒ omitted, not ""
  });

  it("maps a PreToolUse AskUserQuestion with multiple questions to questions[] + questionIndex: 0", () => {
    const ask = buildAskFromEvent({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            header: "DB",
            question: "Which database?",
            multiSelect: false,
            options: [{ label: "Postgres" }, { label: "SQLite" }],
          },
          {
            header: "Cache",
            question: "Which cache?",
            multiSelect: false,
            options: [{ label: "Redis" }, { label: "None" }],
          },
        ],
      },
    });
    if (ask?.kind !== "question") throw new Error("expected a question ask");
    // `question` is the CURRENT one (index 0) — back-compat for single-question consumers.
    expect(ask.question.question).toBe("Which database?");
    expect(ask.questionIndex).toBe(0);
    expect(ask.questions?.map((q) => q.question)).toEqual(["Which database?", "Which cache?"]);
    // Every question is normalized the same way q0 always was (string coercion, options mapped).
    expect(ask.questions?.[1].options.map((o) => o.label)).toEqual(["Redis", "None"]);
  });

  it("a single-question tool call omits questions[]/questionIndex (back-compat)", () => {
    const ask = buildAskFromEvent({
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{ header: "DB", question: "Which database?", multiSelect: false, options: [] }],
      },
    });
    if (ask?.kind !== "question") throw new Error("expected a question ask");
    expect(ask.questions).toBeUndefined();
    expect(ask.questionIndex).toBeUndefined();
  });

  it("maps a PermissionRequest on a tool to an approval", () => {
    const ask = buildAskFromEvent({
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "npm install" },
    });
    expect(ask?.kind).toBe("approval");
    expect(ask?.kind === "approval" && ask.approval.title).toBe("Run command");
    expect(ask?.kind === "approval" && ask.approval.preview).toBe("npm install");
  });

  it("ignores ExitPlanMode (owned by the plan hook) and unrelated events", () => {
    expect(
      buildAskFromEvent({ hook_event_name: "PermissionRequest", tool_name: "ExitPlanMode" }),
    ).toBeNull();
    expect(
      buildAskFromEvent({ hook_event_name: "PostToolUse", tool_name: "AskUserQuestion" }),
    ).toBeNull();
    expect(
      buildAskFromEvent({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: {} }),
    ).toBeNull(); // malformed → fall through
  });
});
