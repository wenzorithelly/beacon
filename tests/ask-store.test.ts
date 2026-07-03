import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";

// Isolate the per-workspace data dir so each test starts from an empty bridge store.
process.env.BEACON_DATA_DIR = mkdtempSync(join(tmpdir(), "beacon-ask-"));

import {
  type AskQuestion,
  askHash,
  clearAskResolution,
  clearPendingAsk,
  isLoopRepush,
  pushAsk,
  questionAnswerReason,
  readAskResolution,
  readPendingAsk,
  resolveAsk,
  summarizeApproval,
} from "@/lib/ask-store";

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
