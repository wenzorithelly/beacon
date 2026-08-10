import { appendFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "bun:test";

const DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-settled-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

import { GET as askGet, POST as askPost } from "@/app/api/ask/route";
import { clearPendingAsk, type PendingAsk, transcriptShowsAnswered, transcriptShowsSettled } from "@/lib/ask-store";
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

// The outcome-agnostic settle signal. Every line below is the REAL shape Claude Code writes (taken
// from live transcripts, 2026-08-09) — including the two that the prose matcher above cannot see:
// the "The user answered:" wording, and the ESCAPE result, which carries neither the marker nor the
// question and fires no PostToolUse hook. Those left a dead question re-prompting in the panel for
// its whole 30-minute TTL.
const resultLine = (id: string, text: string) =>
  JSON.stringify({ type: "user", message: { content: [{ tool_use_id: id, type: "tool_result", content: text }] } });

describe("transcriptShowsSettled (by tool_use_id)", () => {
  const id = "toolu_018RFefkfRwkjmeFkMPsUcpp";
  const q = "Which button in the chrome bar should move to the far left?";

  it("settles on the ESCAPED result — the case with no marker, no question text and no PostToolUse", () => {
    const rejected =
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was " +
      "a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for " +
      "the user to tell you how to proceed.";
    const t = [toolUseLine(q), resultLine(id, rejected)].join("\n");
    expect(transcriptShowsSettled(t, id)).toBe(true);
    expect(transcriptShowsAnswered(t, q)).toBe(false); // prose matcher is blind to it — the bug
  });

  it("settles on the OTHER answered wording the prose matcher misses", () => {
    const t = resultLine(id, `The user answered: "${q}"="Artifacts". Read the answers carefully — they may request…`);
    expect(transcriptShowsSettled(t, id)).toBe(true);
    expect(transcriptShowsAnswered(t, q)).toBe(false);
  });

  it("is FALSE while only the tool_use is present — the id is there, but under \"id\", not \"tool_use_id\"", () => {
    const t = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name: "AskUserQuestion", input: {} }] },
    });
    expect(transcriptShowsSettled(t, id)).toBe(false);
  });

  it("is FALSE for a DIFFERENT tool call's result — a re-ask gets a new id, so it can't false-clear", () => {
    expect(transcriptShowsSettled(resultLine("toolu_other", "The user answered: …"), id)).toBe(false);
  });

  it("is FALSE with no id (an ask pushed before toolUseId existed) or an empty transcript", () => {
    expect(transcriptShowsSettled(resultLine(id, "x"), "")).toBe(false);
    expect(transcriptShowsSettled("", id)).toBe(false);
  });
});

// End-to-end through the route that actually sweeps: push a mirror the way `beacon ask` does, escape
// the picker, poll. This is the bug as the owner saw it — the card still offering options for a
// question the terminal was already done with.
describe("GET /api/ask sweeps an ESCAPED mirror", () => {
  const dir = mkdtempSync(join(tmpdir(), "beacon-escape-"));
  const path = join(dir, "transcript.jsonl");
  const q = "Which button in the chrome bar should move to the far left?";
  const toolUseId = "toolu_018RFefkfRwkjmeFkMPsUcpp";
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const poll = async (): Promise<PendingAsk | null> =>
    ((await (await askGet(new Request("http://test/api/ask"))).json()) as { ask: PendingAsk | null }).ask;

  it("holds the card while the picker is up, and drops it once the user escapes out", async () => {
    clearPendingAsk();
    writeFileSync(path, toolUseLine(q) + "\n");
    await askPost(
      new Request("http://test/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "question",
          question: { header: "Button", question: q, multiSelect: false, options: [{ label: "Artifacts" }] },
          mode: "mirror",
          transcriptPath: path,
          toolUseId,
        }),
      }),
    );
    expect((await poll())?.question?.question).toBe(q); // picker still up — the mirror belongs on screen

    appendFileSync(path, resultLine(toolUseId, "The user doesn't want to proceed with this tool use. …") + "\n");
    expect(await poll()).toBeNull(); // escaped ⇒ gone on the very next poll, not 30 minutes later
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
