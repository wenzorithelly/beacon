import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts from an empty bridge store.
const DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-"));
process.env.BEACON_DATA_DIR = DATA_DIR;

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
  readAskResolutionById,
  readPendingAsk,
  readPendingAsks,
  resolveAsk,
  summarizeApproval,
} from "@/lib/ask-store";
import { sameAskQueue, sameAskView } from "@/lib/ask-view";

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

  it("sameAskQueue: length, order and per-entry view all count", () => {
    const a = { id: "a", questionIndex: 0 } as PendingAsk;
    const b = { id: "b", questionIndex: 0 } as PendingAsk;
    expect(sameAskQueue([a, b], [a, b])).toBe(true);
    expect(sameAskQueue([a, b], [b, a])).toBe(false); // order is what picks the head
    expect(sameAskQueue([a, b], [a])).toBe(false); // one was answered — the card must move on
    expect(sameAskQueue([a], [{ ...a, questionIndex: 1 } as PendingAsk])).toBe(false);
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

// The reported bug (2026-07-19): three agent sessions in ONE workspace each raised a question at the
// same time and only ONE ever rendered — ask-pending.json was a single mutable slot whose setter
// overwrote unconditionally, so the last writer won and the other two agents sat blocked on an
// answer that could never be given. The store holds a queue now; these cover that it does, that each
// entry stays independently addressable, and that the on-disk shape a shipped desktop build reads
// (terminals/ask-deliverer.ts polls this exact file) is unchanged for a single-slot reader.
describe("concurrent asks in one workspace", () => {
  const pushMirror = (question: AskQuestion, now: number) =>
    (
      pushAsk(
        { kind: "question", hash: askHash("question", question), question, mode: "mirror" },
        now,
      ) as { id: string }
    ).id;

  const qDb = q();
  const qCache = q({ header: "Cache", question: "Which cache?", options: [{ label: "Redis" }, { label: "None" }] });
  const qDeploy = q({ header: "Deploy", question: "Where to deploy?", options: [{ label: "Vercel" }] });

  it("three sessions asking at once ALL survive — no clobbering", () => {
    const ids = [pushMirror(qDb, 1000), pushMirror(qCache, 1001), pushMirror(qDeploy, 1002)];

    const queued = readPendingAsks();
    expect(queued).toHaveLength(3);
    expect(queued.map((a) => a.id)).toEqual(ids);
    expect(queued.map((a) => a.question?.question)).toEqual([
      "Which database?",
      "Which cache?",
      "Where to deploy?",
    ]);
  });

  it("each queued ask is independently answerable, and the next one takes the head", () => {
    const [a, b, c] = [pushMirror(qDb, 1000), pushMirror(qCache, 1001), pushMirror(qDeploy, 1002)];

    expect(readPendingAsk()?.id).toBe(a); // FIFO — the longest-blocked session is shown first

    // Answer the middle one out of order: only it goes, the other two stay pending.
    resolveAsk({ id: b, selected: ["Redis"] }, 2000);
    expect(readPendingAsks().map((x) => x.id)).toEqual([a, c]);

    resolveAsk({ id: a, selected: ["SQLite"] }, 2100);
    expect(readPendingAsk()?.id).toBe(c); // the panel moves on instead of going empty

    resolveAsk({ id: c, selected: ["Vercel"] }, 2200);
    expect(readPendingAsk()).toBeNull();

    // Every hook gets ITS OWN verdict back — none was hidden by a later one landing on top of it.
    expect(readAskResolutionById(a)?.selected).toEqual(["SQLite"]);
    expect(readAskResolutionById(b)?.selected).toEqual(["Redis"]);
    expect(readAskResolutionById(c)?.selected).toEqual(["Vercel"]);
  });

  it("markAskDelivered / advancePendingAsk address an ask behind the head, not just the head", () => {
    const head = pushMirror(qDb, 1000);
    const multi = [qCache, qDeploy];
    const behind = (
      pushAsk(
        {
          kind: "question",
          hash: askHash("question", multi),
          question: multi[0],
          questions: multi,
          questionIndex: 0,
          mode: "mirror",
        },
        1001,
      ) as { id: string }
    ).id;

    expect(markAskDelivered(behind, 1500)).toBe(true);
    expect(readPendingAsks().find((a) => a.id === behind)?.deliveredAt).toBe(1500);
    expect(advancePendingAsk(behind)?.questionIndex).toBe(1);
    expect(readPendingAsk()?.id).toBe(head); // head untouched throughout
    expect(readPendingAsks()).toHaveLength(2);
  });

  it("two sessions asking the SAME question in the same millisecond stay two distinct asks", () => {
    // makeAskId is `${hash}-${now}` — identical content at an identical clock tick collided, which
    // would collapse them back into one addressable ask.
    const ids = [pushMirror(qDb, 1000), pushMirror(qDb, 1000), pushMirror(qDb, 1000)];
    expect(new Set(ids).size).toBe(3);
    expect(readPendingAsks()).toHaveLength(3);
  });

  it("the file still reads as a single PendingAsk for an old single-slot consumer (desktop shell)", () => {
    const head = pushMirror(qDb, 1000);
    pushMirror(qCache, 1001);

    // Exactly what terminals/ask-deliverer.ts does: JSON.parse the file and use `.id`/`.question`.
    const raw = JSON.parse(readFileSync(join(DATA_DIR, "ask-pending.json"), "utf8"));
    expect(raw.id).toBe(head);
    expect(raw.question.options.map((o: { label: string }) => o.label)).toEqual(["Postgres", "SQLite"]);
    expect(raw.mode).toBe("mirror");
    expect(raw.asks).toHaveLength(2); // the full queue rides alongside for readers that want it
  });

  it("a legacy single-object file left by an older daemon is read as a one-ask queue", () => {
    const legacy = {
      id: "legacy-1",
      kind: "question",
      hash: "h",
      createdAt: 1000,
      mode: "mirror",
      question: qDb,
    };
    writeFileSync(join(DATA_DIR, "ask-pending.json"), JSON.stringify(legacy));

    expect(readPendingAsks()).toEqual([legacy as unknown as PendingAsk]);
    expect(readPendingAsk()?.id).toBe("legacy-1");

    // …and a new ask queues BEHIND it rather than overwriting it.
    const next = pushMirror(qCache, 2000);
    expect(readPendingAsks().map((a) => a.id)).toEqual(["legacy-1", next]);
  });

  it("back-to-back approval verdicts don't overwrite each other (each hook polls by its own id)", () => {
    const mk = (file: string, now: number) => {
      const approval = summarizeApproval("Write", { file_path: file, content: "x" });
      return (
        pushAsk({ kind: "approval", hash: askHash("approval", undefined, approval), approval }, now) as {
          id: string;
        }
      ).id;
    };
    const first = mk("a.ts", 1000);
    const second = mk("b.ts", 1001);

    resolveAsk({ id: first, decision: "allow" }, 1200);
    resolveAsk({ id: second, decision: "deny" }, 1250);

    expect(readAskResolutionById(first)?.decision).toBe("allow");
    expect(readAskResolutionById(second)?.decision).toBe("deny");
    expect(readAskResolution()?.id).toBe(second); // newest still at the top level
  });
});
