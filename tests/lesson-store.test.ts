import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// dataDir() honors BEACON_DATA_DIR first, so a per-test temp dir fully isolates the disk store.
let DIR = "";
beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), "beacon-lesson-"));
  process.env.BEACON_DATA_DIR = DIR;
});
afterEach(() => {
  rmSync(DIR, { recursive: true, force: true });
  delete process.env.BEACON_DATA_DIR;
});

const {
  pushLesson,
  buildLesson,
  readCurrentLesson,
  clearCurrentLesson,
  writeQuestions,
  readQuestions,
  resetLessonRound,
  saveCurrentLesson,
  listLessons,
  readSavedLesson,
} = await import("@/lib/lesson-store");
const { writeLessonVerdict, readLessonVerdict, clearLessonVerdict } = await import(
  "@/lib/lesson-verdict"
);
const { resolveLessonVerdict } = await import("@/lib/lesson-resolve");

const baseInput = () => ({
  title: "How a plan flows to /plan",
  topic: "explain the plan loop",
  narrative: "## Big picture\n\nThe agent pushes a plan and blocks.",
  nodes: [
    { id: "n1", title: "ExitPlanMode", summary: "the plan hook", detail: "", files: ["bin/plan.ts"] },
    { id: "n2", title: "/plan page", summary: "the review surface", detail: "", files: [] },
  ],
  edges: [{ fromId: "n1", toId: "n2", verb: "routes to" as const }],
});

describe("lesson store — push + current", () => {
  it("pushes a first-round lesson and reads it back with ids + grid positions", () => {
    const l = pushLesson(baseInput(), 1000);
    expect(l.status).toBe("live");
    expect(l.edges[0].id).toBeTruthy(); // edge id filled
    expect(l.nodes[1].x).toBeGreaterThan(0); // unpositioned nodes get a grid
    expect(readCurrentLesson()?.id).toBe(l.id);
  });

  it("preserves agent-supplied node positions instead of re-gridding", () => {
    const input = baseInput();
    input.nodes[0] = { ...input.nodes[0], x: 50, y: 60 };
    const l = pushLesson(input, 1000);
    expect(l.nodes[0].x).toBe(50);
    expect(l.nodes[0].y).toBe(60);
  });

  it("drops edges whose endpoints are not real nodes", () => {
    const input = baseInput();
    input.edges.push({ fromId: "n1", toId: "ghost", verb: "calls" as const });
    const l = pushLesson(input, 1000);
    expect(l.edges).toHaveLength(1);
  });

  it("bumps updatedAt strictly-monotonically across re-pushes, keeping id + createdAt", () => {
    const first = pushLesson(baseInput(), 1000);
    const second = pushLesson(baseInput(), 1000); // same clock — must still advance
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });

  it("clearCurrentLesson removes the live lesson", () => {
    pushLesson(baseInput(), 1000);
    clearCurrentLesson();
    expect(readCurrentLesson()).toBeNull();
  });
});

describe("lesson store — round questions + answer merge", () => {
  const q = {
    id: "q1",
    anchor: { kind: "node" as const, nodeId: "n2" },
    question: "why does it block?",
    askedAt: 5,
  };

  it("buffers questions and reads them back", () => {
    writeQuestions({ questions: [q], submitted: true });
    expect(readQuestions().submitted).toBe(true);
    expect(readQuestions().questions[0].question).toBe("why does it block?");
  });

  it("folds answered questions into the lesson and clears the round buffer on re-push", () => {
    pushLesson(baseInput(), 1000);
    writeQuestions({ questions: [q], submitted: true });
    const merged = pushLesson({ ...baseInput(), answers: [{ questionId: "q1", answer: "to wait for the verdict" }] }, 1000);
    expect(merged.questions).toHaveLength(1);
    expect(merged.questions[0].answer).toBe("to wait for the verdict");
    expect(merged.questions[0].answeredAt).toBeDefined();
    expect(readQuestions().questions).toHaveLength(0); // buffer cleared
  });

  it("resetLessonRound clears the buffer", () => {
    writeQuestions({ questions: [q], submitted: true });
    resetLessonRound();
    expect(readQuestions()).toEqual({ questions: [], submitted: false });
  });

  it("a re-push WITHOUT answers keeps submitted questions in the buffer (no swallow)", () => {
    // The timeout/resume case: the user sent questions while no beacon_explain call was
    // blocking; the agent resumes by re-pushing the same lesson. That push must NOT eat the
    // questions — the next verdict poll re-delivers them.
    pushLesson(baseInput(), 1000);
    writeQuestions({ questions: [q], submitted: true });
    const l = pushLesson(baseInput(), 2000);
    expect(readQuestions()).toEqual({ questions: [q], submitted: true });
    expect(resolveLessonVerdict().kind).toBe("questions");
    // Folded into the lesson exactly once (visible as "waiting…"), even across re-pushes.
    expect(l.questions).toHaveLength(1);
    expect(pushLesson(baseInput(), 3000).questions).toHaveLength(1);
  });

  it("answering a previously-preserved question finally clears it from the buffer", () => {
    pushLesson(baseInput(), 1000);
    writeQuestions({ questions: [q], submitted: true });
    pushLesson(baseInput(), 2000); // resume push — question preserved
    const answered = pushLesson({ ...baseInput(), answers: [{ questionId: "q1", answer: "a" }] }, 3000);
    expect(answered.questions).toHaveLength(1);
    expect(answered.questions[0].answer).toBe("a");
    expect(readQuestions()).toEqual({ questions: [], submitted: false });
  });

  it("unsubmitted drafts are neither folded into the lesson nor handed to the agent", () => {
    pushLesson(baseInput(), 1000);
    writeQuestions({ questions: [q], submitted: false });
    const l = pushLesson(baseInput(), 2000);
    expect(l.questions).toHaveLength(0);
  });

  it("buildLesson is pure over (input, prev) and filters step focusIds to real nodes", () => {
    const l = buildLesson(
      { ...baseInput(), steps: [{ title: "step", summary: "", focusIds: ["n1", "ghost"] }] } as never,
      null,
      1000,
    );
    expect(l.steps[0].focusIds).toEqual(["n1"]);
  });
});

describe("lesson library", () => {
  it("saves the current lesson, lists it, and reads it back as saved", () => {
    const l = pushLesson(baseInput(), 1000);
    const savedId = saveCurrentLesson(2000);
    expect(savedId).toBe(l.id);
    const list = listLessons();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: l.id, nodeCount: 2 });
    expect(readSavedLesson(l.id)?.status).toBe("saved");
  });

  it("saveCurrentLesson returns null when there is no live lesson", () => {
    expect(saveCurrentLesson(2000)).toBeNull();
  });
});

describe("lesson verdict + resolution priority", () => {
  it("resolves to none when nothing is on disk", () => {
    expect(resolveLessonVerdict()).toEqual({ kind: "none" });
  });

  it("resolves to pending when a live lesson exists with no decision", () => {
    pushLesson(baseInput(), 1000);
    expect(resolveLessonVerdict().kind).toBe("pending");
  });

  it("resolves to questions when the round buffer is submitted (beats a live lesson)", () => {
    pushLesson(baseInput(), 1000);
    writeQuestions({
      questions: [{ id: "q1", anchor: { kind: "overall" }, question: "wat?", askedAt: 1 }],
      submitted: true,
    });
    const r = resolveLessonVerdict();
    expect(r.kind).toBe("questions");
    if (r.kind === "questions") expect(r.questions).toHaveLength(1);
  });

  it("does NOT resolve to questions when the buffer is unsubmitted", () => {
    pushLesson(baseInput(), 1000);
    writeQuestions({
      questions: [{ id: "q1", anchor: { kind: "overall" }, question: "wat?", askedAt: 1 }],
      submitted: false,
    });
    expect(resolveLessonVerdict().kind).toBe("pending");
  });

  it("resolves to saved / closed from the verdict file", () => {
    writeLessonVerdict({ updatedAt: 1, status: "saved", lessonId: "abc", summary: "saved", decidedAt: 2 });
    expect(resolveLessonVerdict()).toMatchObject({ kind: "saved", lessonId: "abc" });
    clearLessonVerdict();
    expect(readLessonVerdict()).toBeNull();
    writeLessonVerdict({ updatedAt: 1, status: "closed", summary: "closed", decidedAt: 2 });
    expect(resolveLessonVerdict().kind).toBe("closed");
  });
});
