import { describe, expect, it } from "bun:test";
import {
  looksLikePlanApprovalRequest,
  lastAssistantText,
  closingText,
  shouldNudgeToPresentPlan,
} from "@/lib/stop-hook-detect";

describe("looksLikePlanApprovalRequest", () => {
  it("fires on real 'asking for the go-ahead in prose' endings", () => {
    const cases = [
      "Two things to confirm: (1) repurpose the dead Note model, or keep it and name the new one Memo? (2) Anything to change before I send it to the board?",
      "If this looks right, my next step is to push the Note table. Then I implement with TDD.",
      "Want me to kick it off now, or keep sending quick UI fixes first?",
      "Should I proceed with the implementation?",
      "Let me know if you'd like me to adjust the approach before I build it.",
      "Does this approach look right to you?",
    ];
    for (const c of cases) expect(looksLikePlanApprovalRequest(c)).toBe(true);
  });

  it("does NOT fire on normal status / clarifying questions", () => {
    const cases = [
      "I implemented the fix and all 413 tests pass.",
      "This looks like a rendering bug in the markdown table.",
      "Should I use tabs or spaces in this file?", // a small clarification, not a plan go-ahead
      "Here's a summary of what I changed.",
      "",
    ];
    for (const c of cases) expect(looksLikePlanApprovalRequest(c)).toBe(false);
  });
});

describe("lastAssistantText", () => {
  it("returns the text of the LAST assistant message, tolerating unparseable lines", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
      "<<corrupt partial line", // tail-read can start mid-line; must be skipped
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "earlier reply" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Should I proceed with the plan?" },
            { type: "tool_use", name: "Bash", input: {} },
          ],
        },
      }),
    ].join("\n");
    expect(lastAssistantText(jsonl)).toBe("Should I proceed with the plan?");
  });

  it("returns '' when there is no assistant message", () => {
    expect(lastAssistantText(JSON.stringify({ type: "user", message: { role: "user", content: "x" } }))).toBe("");
    expect(lastAssistantText("")).toBe("");
  });
});

describe("closingText", () => {
  it("returns the last non-empty paragraph", () => {
    expect(closingText("intro para\n\nmiddle para\n\nfinal para")).toBe("final para");
    expect(closingText("only one")).toBe("only one");
    expect(closingText("")).toBe("");
  });
});

describe("shouldNudgeToPresentPlan — only the closing counts (no false positive on explanations)", () => {
  it("does NOT nudge when trigger phrases appear only mid-message (quoted as examples)", () => {
    // This is the real false positive: an EXPLANATION of the feature that quotes the trigger
    // phrases, with a benign closing paragraph. It must not be read as an approval request.
    const explanation = [
      "Here is how the detector works.",
      "",
      'It matches phrases like "should I proceed", "want me to", and "two things to confirm".',
      "",
      "All of this is still uncommitted, held per your earlier call.",
    ].join("\n");
    const jsonl = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: explanation }] },
    });
    expect(shouldNudgeToPresentPlan(jsonl)).toBe(false);
  });

  it("still nudges when the CLOSING paragraph is the approval request", () => {
    const text = ["Here's the plan: add a Note table and three endpoints.", "", "Should I proceed?"].join(
      "\n",
    );
    const jsonl = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
    expect(shouldNudgeToPresentPlan(jsonl)).toBe(true);
  });
});

describe("shouldNudgeToPresentPlan", () => {
  it("true when the last assistant message asks for approval in prose", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "If this looks right, want me to proceed?" }] },
    });
    expect(shouldNudgeToPresentPlan(jsonl)).toBe(true);
  });

  it("false when the last assistant message is just a status update", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Done — all tests pass." }] },
    });
    expect(shouldNudgeToPresentPlan(jsonl)).toBe(false);
  });
});
