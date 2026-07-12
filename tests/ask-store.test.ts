import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts from an empty bridge store.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-"));

import {
  advancePendingAsk,
  type AskQuestion,
  askHash,
  clearAskResolution,
  clearPendingAsk,
  isLoopRepush,
  markAskDelivered,
  type PendingAsk,
  pushAsk,
  questionAnswerReason,
  questionMirrorPushBody,
  readAskResolution,
  readPendingAsk,
  resolveAsk,
  summarizeApproval,
} from "@/lib/ask-store";
import { sameAskView } from "@/lib/ask-view";

const q = (over: Partial<AskQuestion> = {}): AskQuestion => ({
  header: "DB",
  question: "Which database?",
  multiSelect: false,
  options: [
    { label: "Postgres" },
    { label: "SQLite" },
  ],
  ...over,
});

beforeEach(() => {
  clearPendingAsk();
  clearAskResolution();
});

describe("pure helpers", () => {
  it("askHash is stable for identical content, differs on change", () => {
    expect(askHash("question", q())).toBe(askHash("question", q()));
    expect(askHash("question", q())).not.toBe(askHash("question", q({ question: "Which cache?" })));
  });

  it("questionAnswerReason is imperative, names the pick, forbids retry", () => {
    const r = questionAnswerReason(q(), ["SQLite"]);
    expect(r).toContain('"SQLite"');
    expect(r).toContain("ANSWERED_IN_BEACON");
    expect(r).toMatch(/do NOT call AskUserQuestion again/i);
  });

  it("summarizeApproval renders each tool", () => {
    expect(summarizeApproval("Bash", { command: "rm -rf build" })).toEqual({
      tool: "Bash",
      title: "Run command",
      preview: "rm -rf build",
    });
    expect(summarizeApproval("Write", { file_path: "a.ts", content: "x" }).title).toBe("Write a.ts");
    expect(summarizeApproval("Edit", { file_path: "a.ts", old_string: "a", new_string: "b" }).preview).toBe(
      "- a\n+ b",
    );
  });

  it("askHash on a single question is byte-identical to hashing that question alone (back-compat)", () => {
    const single = askHash("question", q());
    // A 1-element questions[] is NOT the same shape as a bare question — callers must pass the bare
    // question for a single-question ask to get the pre-v2 hash (see app/api/ask/route.ts's hashBasis).
    expect(askHash("question", [q()])).not.toBe(single);
  });

  it("askHash on a questions[] set changes when ANY question in the set changes", () => {
    const set = [q(), q({ header: "Cache", question: "Which cache?" })];
    const same = [q(), q({ header: "Cache", question: "Which cache?" })];
    const changed = [q(), q({ header: "Cache", question: "Which OTHER cache?" })];
    expect(askHash("question", set)).toBe(askHash("question", same));
    expect(askHash("question", set)).not.toBe(askHash("question", changed));
  });

  it("questionMirrorPushBody always mirrors a question, regardless of anything else", () => {
    const body = questionMirrorPushBody(q(), "/path/to/transcript.jsonl");
    expect(body).toEqual({
      kind: "question",
      question: q(),
      mode: "mirror",
      transcriptPath: "/path/to/transcript.jsonl",
    });
  });

  it("questionMirrorPushBody tolerates a missing transcript path (still mirrors)", () => {
    expect(questionMirrorPushBody(q(), undefined).mode).toBe("mirror");
  });

  it("questionMirrorPushBody carries questions[]/questionIndex through when given (v2 multi-question)", () => {
    const qs = [q(), q({ header: "Cache", question: "Which cache?" })];
    const body = questionMirrorPushBody(q(), "/t.jsonl", qs, 0);
    expect(body.questions).toEqual(qs);
    expect(body.questionIndex).toBe(0);
  });

  it("sameAskView: false when questionIndex differs (the freeze bug — same id, next question)", () => {
    const base = { id: "abc", questionIndex: 0, deliveredAt: undefined } as PendingAsk;
    const advanced = { ...base, questionIndex: 1 } as PendingAsk;
    expect(sameAskView(base, advanced)).toBe(false);
  });

  it("sameAskView: false when deliveredAt differs (undefined vs a number)", () => {
    const base = { id: "abc", questionIndex: 0, deliveredAt: undefined } as PendingAsk;
    const delivered = { ...base, deliveredAt: 1500 } as PendingAsk;
    expect(sameAskView(base, delivered)).toBe(false);
  });

  it("sameAskView: true for identical snapshots (stability preserved, no needless re-render)", () => {
    const a = { id: "abc", questionIndex: 0, deliveredAt: 1500 } as PendingAsk;
    const b = { id: "abc", questionIndex: 0, deliveredAt: 1500 } as PendingAsk;
    expect(sameAskView(a, b)).toBe(true);
  });

  it("sameAskView: null vs null is true, object vs null is false", () => {
    expect(sameAskView(null, null)).toBe(true);
    const a = { id: "abc", questionIndex: 0, deliveredAt: undefined } as PendingAsk;
    expect(sameAskView(a, null)).toBe(false);
    expect(sameAskView(null, a)).toBe(false);
  });

  it("isLoopRepush: only questions, same hash, within window", () => {
    const res = { id: "x", hash: "H", kind: "question" as const, selected: ["a"], decidedAt: 1000 };
    expect(isLoopRepush(res, "H", "question", 1100, 60_000)).toBe(true); // repeat, fresh
    expect(isLoopRepush(res, "H", "question", 99_000, 60_000)).toBe(false); // window elapsed
    expect(isLoopRepush(res, "OTHER", "question", 1100, 60_000)).toBe(false); // different question
    expect(isLoopRepush({ ...res, kind: "approval" }, "H", "approval", 1100, 60_000)).toBe(false); // approvals never loop-guard
    expect(isLoopRepush(null, "H", "question", 1100, 60_000)).toBe(false); // nothing answered yet
  });
});

describe("bridge lifecycle", () => {
  it("push → modal reads pending → answer → hook reads resolution by id", () => {
    const hash = askHash("question", q());
    const r = pushAsk({ kind: "question", hash, question: q() }, 1000);
    expect(r.loop).toBe(false);
    const id = (r as { id: string }).id;

    const pending = readPendingAsk();
    expect(pending?.id).toBe(id);
    expect(pending?.question?.options.map((o) => o.label)).toEqual(["Postgres", "SQLite"]);

    resolveAsk({ id, selected: ["SQLite"] }, 2000);
    expect(readPendingAsk()).toBeNull(); // modal closes
    const res = readAskResolution();
    expect(res?.id).toBe(id);
    expect(res?.selected).toEqual(["SQLite"]);
  });

  it("loop-guard: an immediate re-ask of the same answered question is let through", () => {
    const hash = askHash("question", q());
    const first = pushAsk({ kind: "question", hash, question: q() }, 1000) as { id: string };
    resolveAsk({ id: first.id, selected: ["Postgres"] }, 1500);

    // Agent re-calls AskUserQuestion with the SAME question right away → loop.
    expect(pushAsk({ kind: "question", hash, question: q() }, 2000)).toEqual({ loop: true });

    // A genuinely different question is NOT a loop.
    const q2 = q({ question: "Which cache?" });
    const r2 = pushAsk({ kind: "question", hash: askHash("question", q2), question: q2 }, 2100);
    expect(r2.loop).toBe(false);
  });

  it("a push clears a stale resolution so the hook waits for the real answer", () => {
    const h1 = askHash("question", q());
    const a = pushAsk({ kind: "question", hash: h1, question: q() }, 1000) as { id: string };
    resolveAsk({ id: a.id, selected: ["Postgres"] }, 1100);

    // Much later, a different question pushes → the old resolution must not leak to its hook.
    const q2 = q({ question: "Deploy where?" });
    const b = pushAsk(
      { kind: "question", hash: askHash("question", q2), question: q2 },
      1100 + 10 * 60 * 1000,
    ) as { id: string };
    const res = readAskResolution();
    expect(res).toBeNull(); // cleared by the new push; hook for `b` keeps polling until answered
    expect(b.id).not.toBe(a.id);
  });

  it("approval flow carries an allow/deny decision", () => {
    const appr = summarizeApproval("Write", { file_path: "x.ts", content: "hi" });
    const hash = askHash("approval", undefined, appr);
    const r = pushAsk({ kind: "approval", hash, approval: appr }, 1000) as { id: string };
    resolveAsk({ id: r.id, decision: "deny" }, 1200);
    expect(readAskResolution()?.decision).toBe("deny");
  });
});

describe("markAskDelivered", () => {
  it("flags the pending ask so the modal can show a 'sent' state", () => {
    const hash = askHash("question", q());
    const pushed = pushAsk({ kind: "question", hash, question: q(), mode: "mirror" }, 1000) as {
      id: string;
    };
    expect(markAskDelivered(pushed.id, 1500)).toBe(true);
    expect(readPendingAsk()?.deliveredAt).toBe(1500);
  });

  it("is a no-op when the id no longer names the pending ask", () => {
    const hash = askHash("question", q());
    pushAsk({ kind: "question", hash, question: q(), mode: "mirror" }, 1000);
    expect(markAskDelivered("some-stale-id", 1500)).toBe(false);
    expect(readPendingAsk()?.deliveredAt).toBeUndefined();
  });

  it("is a no-op when there is no pending ask at all", () => {
    clearPendingAsk();
    expect(markAskDelivered("anything", 1500)).toBe(false);
  });
});

describe("advancePendingAsk", () => {
  const questions = [q(), q({ header: "Cache", question: "Which cache?" }), q({ header: "Deploy", question: "Where?" })];

  it("moves question/questionIndex forward, keeping id/createdAt/hash, clearing deliveredAt", () => {
    const hash = askHash("question", questions);
    const pushed = pushAsk(
      { kind: "question", hash, question: questions[0], questions, questionIndex: 0, mode: "mirror" },
      1000,
    ) as { id: string };
    markAskDelivered(pushed.id, 1200);
    expect(readPendingAsk()?.deliveredAt).toBe(1200);

    const advanced = advancePendingAsk(pushed.id);
    expect(advanced?.id).toBe(pushed.id);
    expect(advanced?.questionIndex).toBe(1);
    expect(advanced?.question).toEqual(questions[1]);
    expect(advanced?.deliveredAt).toBeUndefined();
    expect(advanced?.createdAt).toBe(1000);
    expect(advanced?.hash).toBe(hash);
    expect(readPendingAsk()).toEqual(advanced); // written to disk
  });

  it("returns null (no-op) once there is no next question (the last one)", () => {
    const hash = askHash("question", questions);
    const pushed = pushAsk(
      { kind: "question", hash, question: questions[2], questions, questionIndex: 2, mode: "mirror" },
      1000,
    ) as { id: string };
    expect(advancePendingAsk(pushed.id)).toBeNull();
    expect(readPendingAsk()?.questionIndex).toBe(2); // untouched
  });

  it("returns null for a single-question ask (no questions[] to advance through)", () => {
    const hash = askHash("question", q());
    const pushed = pushAsk({ kind: "question", hash, question: q(), mode: "mirror" }, 1000) as {
      id: string;
    };
    expect(advancePendingAsk(pushed.id)).toBeNull();
  });

  it("returns null when id no longer matches the pending ask", () => {
    const hash = askHash("question", questions);
    pushAsk(
      { kind: "question", hash, question: questions[0], questions, questionIndex: 0, mode: "mirror" },
      1000,
    );
    expect(advancePendingAsk("stale-id")).toBeNull();
  });
});
