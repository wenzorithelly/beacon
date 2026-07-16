import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dataDir } from "@/lib/project";
import { writeJsonAtomic } from "@/lib/atomic-write";
import {
  LESSON_VERBS,
  type Lesson,
  type LessonEdge,
  type LessonNode,
  type LessonQuestion,
  type LessonStep,
  type LessonTable,
  type LessonVerb,
  type SavedLessonSummary,
} from "@/lib/lesson-types";

// Disk store for the learning surface, mirroring the plan-loop's on-disk state. The LIVE lesson
// the agent is explaining lives at dataDir()/lesson-current.json; the user's in-progress questions
// for the current round live at dataDir()/lesson-questions.json (the analog of plan-annotations);
// saved lessons are archived under dataDir()/lessons/<id>.json so the library can list them.
// Everything is plain JSON written atomically — the blocking beacon_explain poll reads it.

function currentPath(): string {
  return join(dataDir(), "lesson-current.json");
}
function questionsPath(): string {
  return join(dataDir(), "lesson-questions.json");
}
function libraryDir(): string {
  const d = join(dataDir(), "lessons");
  mkdirSync(d, { recursive: true });
  return d;
}

// ── The agent's input payload (beacon_explain / POST /api/lesson) ─────────────

const verbEnum = z.enum(LESSON_VERBS as unknown as [string, ...string[]]);

const nodeInput = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().default(""),
  detail: z.string().default(""),
  files: z.array(z.string()).default([]),
  group: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const edgeInput = z.object({
  id: z.string().optional(),
  fromId: z.string().trim().min(1),
  toId: z.string().trim().min(1),
  verb: verbEnum,
});

const stepInput = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1),
  summary: z.string().default(""),
  focusIds: z.array(z.string()).default([]),
  narrativeAnchor: z.string().optional(),
});

const columnInput = z.object({
  name: z.string().trim().min(1),
  type: z.string().default("text"),
  isPk: z.boolean().optional(),
  isFk: z.boolean().optional(),
  fkTo: z.string().optional(),
  note: z.string().optional(),
});

const tableInput = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  domain: z.string().optional(),
  note: z.string().optional(),
  group: z.string().optional(),
  columns: z.array(columnInput).default([]),
  sample: z.array(z.record(z.string(), z.string())).optional(),
});

export const lessonInputSchema = z.object({
  title: z.string().trim().min(1),
  topic: z.string().default(""),
  narrative: z.string().default(""),
  nodes: z.array(nodeInput).default([]),
  edges: z.array(edgeInput).default([]),
  tables: z.array(tableInput).default([]),
  steps: z.array(stepInput).optional(),
  // On a re-push the agent answers the user's questions by id.
  answers: z.array(z.object({ questionId: z.string(), answer: z.string() })).optional(),
  // Filled by beacon_explain from the terminal hook state; never supplied by the lesson UI.
  ownerSessionId: z.string().trim().min(1).optional(),
});
export type LessonInput = z.infer<typeof lessonInputSchema>;

// ── Current (live) lesson ────────────────────────────────────────────────────

export function readCurrentLesson(): Lesson | null {
  try {
    return JSON.parse(readFileSync(currentPath(), "utf8")) as Lesson;
  } catch {
    return null;
  }
}

export function writeCurrentLesson(lesson: Lesson): void {
  writeJsonAtomic(currentPath(), lesson);
}

export function clearCurrentLesson(): void {
  rmSync(currentPath(), { force: true });
}

// Lay nodes the agent didn't position into a simple 3-column grid so they don't stack at the
// origin. Agent-supplied coordinates win and are preserved; the canvas runs a proper one-time
// layered layout and freezes it (Phase 4). Deterministic — no Math.random.
const GRID_COLS = 3;
const GRID_X = 320;
const GRID_Y = 200;
function placed(nodes: LessonNode[]): LessonNode[] {
  const anyPositioned = nodes.some((n) => (n.x ?? 0) !== 0 || (n.y ?? 0) !== 0);
  if (anyPositioned) return nodes.map((n) => ({ ...n, x: n.x ?? 0, y: n.y ?? 0 }));
  return nodes.map((n, i) => ({
    ...n,
    x: (i % GRID_COLS) * GRID_X,
    y: Math.floor(i / GRID_COLS) * GRID_Y,
  }));
}

// Turn a validated input payload into a Lesson, merging it over the previous round when re-pushed:
// edge/step ids are filled, positions assigned, updatedAt bumped strictly-monotonically, and the
// just-asked questions (from the round buffer) are folded into the lesson with the agent's answers
// attached. Clearing the buffer is the caller's job (resetLessonRound) so this stays pure-ish.
export function buildLesson(input: LessonInput, prev: Lesson | null, now = Date.now()): Lesson {
  const nodes = placed(
    input.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      summary: n.summary,
      detail: n.detail,
      files: n.files,
      group: n.group,
      x: n.x ?? 0,
      y: n.y ?? 0,
    })),
  );
  const tables: LessonTable[] = (input.tables ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    domain: t.domain,
    note: t.note,
    group: t.group,
    columns: t.columns,
    sample: t.sample,
  }));
  // Edges + step spotlights may reference a concept node OR a table — both live on the board.
  const boardIds = new Set([...nodes.map((n) => n.id), ...tables.map((t) => t.id)]);
  const edges: LessonEdge[] = input.edges
    // Drop edges whose endpoints aren't real board entities rather than render dangling arrows.
    .filter((e) => boardIds.has(e.fromId) && boardIds.has(e.toId))
    .map((e) => ({
      id: e.id ?? randomUUID().slice(0, 8),
      fromId: e.fromId,
      toId: e.toId,
      verb: e.verb as LessonVerb,
    }));
  const steps: LessonStep[] = (input.steps ?? []).map((s, i) => ({
    id: s.id ?? `step-${i}`,
    title: s.title,
    summary: s.summary,
    focusIds: s.focusIds.filter((id) => boardIds.has(id)),
    narrativeAnchor: s.narrativeAnchor,
  }));

  const answersById = new Map((input.answers ?? []).map((a) => [a.questionId, a.answer]));
  const buffer = readQuestions();
  // Any answer that targets an already-recorded question (a later round answering an older one).
  const prevQuestions = (prev?.questions ?? []).map((q) => {
    const answer = answersById.get(q.id);
    return answer && !q.answer ? { ...q, answer, answeredAt: now } : q;
  });
  // The questions the user SUBMITTED this round become entries on the lesson (answered when the
  // push carries their answer, "waiting" otherwise). Unsent drafts never fold in; a question a
  // previous push already folded (preserved in the buffer because it went unanswered) isn't
  // duplicated.
  const prevIds = new Set(prevQuestions.map((q) => q.id));
  const submittedThisRound: LessonQuestion[] = buffer.submitted
    ? buffer.questions
        .filter((q) => !prevIds.has(q.id))
        .map((q) => {
          const answer = answersById.get(q.id);
          return answer ? { ...q, answer, answeredAt: now } : q;
        })
    : [];
  const questions = [...prevQuestions, ...submittedThisRound];

  return {
    id: prev?.id ?? randomUUID().slice(0, 8),
    ownerSessionId: input.ownerSessionId ?? prev?.ownerSessionId,
    title: input.title,
    topic: input.topic || prev?.topic || input.title,
    createdAt: prev?.createdAt ?? now,
    updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1),
    status: "live",
    narrative: input.narrative,
    nodes,
    edges,
    tables,
    steps,
    questions,
  };
}

// Push a lesson (first round or a re-push with answers): build it over the current one, then
// settle the round buffer. Answered questions leave the buffer; SUBMITTED questions the push did
// NOT answer stay submitted — a re-push that resumes after the blocking tool timed out must not
// swallow them, so the agent's next verdict poll re-delivers them.
export function pushLesson(input: LessonInput, now = Date.now()): Lesson {
  const buffer = readQuestions();
  const lesson = buildLesson(input, readCurrentLesson(), now);
  writeCurrentLesson(lesson);
  const answered = new Set(lesson.questions.filter((q) => q.answer).map((q) => q.id));
  const remaining = buffer.submitted ? buffer.questions.filter((q) => !answered.has(q.id)) : [];
  if (remaining.length) writeQuestions({ questions: remaining, submitted: true });
  else resetLessonRound();
  return lesson;
}

// ── Round question buffer (the user's current, not-yet-answered questions) ─────

export interface StoredQuestions {
  questions: LessonQuestion[];
  submitted: boolean;
  /** Identity fence for durable recovery. A queue is invalid as soon as the live lesson changes. */
  lessonId?: string;
  lessonCreatedAt?: number;
  ownerSessionId?: string;
}

export function readQuestions(): StoredQuestions {
  try {
    const raw = JSON.parse(readFileSync(questionsPath(), "utf8")) as Partial<StoredQuestions>;
    return {
      questions: raw.questions ?? [],
      submitted: !!raw.submitted,
      ...(typeof raw.lessonId === "string" ? { lessonId: raw.lessonId } : {}),
      ...(typeof raw.lessonCreatedAt === "number" ? { lessonCreatedAt: raw.lessonCreatedAt } : {}),
      ...(typeof raw.ownerSessionId === "string" ? { ownerSessionId: raw.ownerSessionId } : {}),
    };
  } catch {
    return { questions: [], submitted: false };
  }
}

export function writeQuestions(q: StoredQuestions): void {
  writeJsonAtomic(questionsPath(), q);
}

export function resetLessonRound(): void {
  rmSync(questionsPath(), { force: true });
}

// ── Library (saved lessons) ────────────────────────────────────────────────────

// Persist the current lesson into the library and mark it saved. Returns the saved id.
export function saveCurrentLesson(now = Date.now()): string | null {
  const lesson = readCurrentLesson();
  if (!lesson) return null;
  const saved: Lesson = { ...lesson, status: "saved", updatedAt: now };
  writeJsonAtomic(join(libraryDir(), `${saved.id}.json`), saved, true);
  return saved.id;
}

export function listLessons(): SavedLessonSummary[] {
  let entries: string[];
  try {
    entries = readdirSync(libraryDir());
  } catch {
    return [];
  }
  const items: SavedLessonSummary[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const l = JSON.parse(readFileSync(join(libraryDir(), name), "utf8")) as Lesson;
      items.push({
        id: l.id,
        title: l.title,
        topic: l.topic,
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
        nodeCount: l.nodes?.length ?? 0,
        questionCount: l.questions?.length ?? 0,
      });
    } catch {
      /* skip corrupt */
    }
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readSavedLesson(id: string): Lesson | null {
  try {
    return JSON.parse(readFileSync(join(libraryDir(), `${id}.json`), "utf8")) as Lesson;
  } catch {
    return null;
  }
}
