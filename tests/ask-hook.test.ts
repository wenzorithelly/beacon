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
