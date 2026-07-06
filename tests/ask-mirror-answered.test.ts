import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";
import { transcriptShowsAnswered } from "@/lib/ask-store";
import { readFileRange } from "@/lib/read-tail";

// The mirror auto-clear signal: Claude Code records an answered AskUserQuestion as a tool_result
// line — `Your questions have been answered: "<q>"="<answer>"`. We detect it in the raw JSONL
// transcript. The trap: the SAME question text also appears in the un-answered tool_use line, and
// an OLD answered question elsewhere in the tail carries the marker — so marker + question must
// co-occur on ONE line (one message per JSONL line), never matched separately.

const toolUseLine = (q: string) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "AskUserQuestion", input: { questions: [{ question: q, header: "H", options: [] }] } }] },
  });

const answeredLine = (q: string, a: string) =>
  JSON.stringify({
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_x",
          content: `Your questions have been answered: "${q}"="${a}". You can now continue with these answers in mind.`,
        },
      ],
    },
  });

describe("transcriptShowsAnswered", () => {
  const q = "How should the version picker be reshaped?";

  it("is true once the answered tool_result for this question is in the transcript", () => {
    const t = [toolUseLine(q), answeredLine(q, "Confident pick + collapse")].join("\n");
    expect(transcriptShowsAnswered(t, q)).toBe(true);
  });

  it("is FALSE while only the tool_use (asked, not answered) is present", () => {
    expect(transcriptShowsAnswered(toolUseLine(q), q)).toBe(false);
  });

  it("is FALSE when the marker comes from a DIFFERENT question's old answer + this one is only asked", () => {
    const t = [answeredLine("Some earlier unrelated question?", "yes"), toolUseLine(q)].join("\n");
    expect(transcriptShowsAnswered(t, q)).toBe(false);
  });

  it("handles a question containing quotes (JSON-escaped in the transcript)", () => {
    const qq = 'Use the "confident pick" layout?';
    const t = answeredLine(qq, "yes");
    expect(transcriptShowsAnswered(t, qq)).toBe(true);
  });

  it("is FALSE for an empty question or empty transcript", () => {
    expect(transcriptShowsAnswered("", q)).toBe(false);
    expect(transcriptShowsAnswered(answeredLine(q, "x"), "")).toBe(false);
  });
});

// The mirror auto-clear scans the transcript ONLY from the byte offset captured when it was pushed
// (readFileRange), so a re-asked identical question can't false-clear against the PRIOR answer.
// This is the real fix for the "text-only key" finding — exercised end-to-end over a temp file.
describe("mirror answered-since-offset (re-ask isolation)", () => {
  const dir = mkdtempSync(join(tmpdir(), "beacon-mirror-"));
  const path = join(dir, "transcript.jsonl");
  const q = "How should the picker be reshaped?";
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("does NOT see a PRIOR answer to the same question (before the mirror's offset)", () => {
    writeFileSync(path, answeredLine(q, "Old pick") + "\n"); // an earlier, already-answered instance
    const offset = statSync(path).size; // mirror for the RE-ASK is pushed here
    appendFileSync(path, toolUseLine(q) + "\n"); // agent re-asks the same question (not yet answered)
    const since = readFileRange(path, offset, 1_048_576);
    expect(transcriptShowsAnswered(since, q)).toBe(false); // re-ask stays visible, not falsely cleared
  });

  it("DOES see the answer once the re-ask is actually answered (after the offset)", () => {
    writeFileSync(path, answeredLine(q, "Old pick") + "\n");
    const offset = statSync(path).size;
    appendFileSync(path, toolUseLine(q) + "\n" + answeredLine(q, "New pick") + "\n");
    const since = readFileRange(path, offset, 1_048_576);
    expect(transcriptShowsAnswered(since, q)).toBe(true);
  });
});
