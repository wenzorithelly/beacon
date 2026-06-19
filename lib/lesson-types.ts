// Client-safe Lesson types — imported by both the React surfaces and the server store, so this
// file must NOT pull in node:fs/path. A Lesson is the agent's interactive explanation of part of
// the codebase: a curated concept map (nodes + verb-labeled arrows) paired with a plain-English
// narrative, plus the running Q&A between the user and the agent. Stored as one JSON document per
// workspace (like an archived plan) — there are no Lesson database tables.

// The controlled vocabulary for an edge's relationship. A closed set keeps the map readable as
// propositions ("route handler PERSISTS TO table") and lets the agent label edges deterministically
// from the import graph / endpoint↔table data. Never ship a bare, unlabeled line.
export const LESSON_VERBS = [
  "imports",
  "calls",
  "persists to",
  "reads from",
  "writes to",
  "routes to",
  "depends on",
  "emits",
  "returns",
  "contains",
  "extends",
] as const;
export type LessonVerb = (typeof LESSON_VERBS)[number];

export interface LessonNode {
  id: string;
  title: string;
  /** One-line plain-English summary shown on the node face. */
  summary: string;
  /** Fuller plain-English explanation, revealed on click (markdown). */
  detail: string;
  /** Real repo-relative paths this node maps to — rendered as clickable file chips. */
  files: string[];
  /** Optional cluster label for landmark regions. */
  group?: string;
  x: number;
  y: number;
}

export interface LessonEdge {
  id: string;
  fromId: string;
  toId: string;
  verb: LessonVerb;
}

// A database table the lesson teaches — rendered as an annotated schema card on the board, joined to
// the concept nodes by the same labeled edges. Lesson edges may reference a table's id (e.g. a
// concept "persists to" a table); FK edges between tables are derived from columns' `fkTo`.
export interface LessonColumn {
  name: string;
  type: string;
  isPk?: boolean;
  isFk?: boolean;
  /** Target table id this column references (drives the FK edge + the "→ table" hint). */
  fkTo?: string;
  /** Plain-English: what this column is for. */
  note?: string;
}

export interface LessonTable {
  id: string;
  name: string;
  domain?: string;
  /** One plain-English line: why this table exists. */
  note?: string;
  /** Optional cluster label for the layered layout banding (defaults to domain). */
  group?: string;
  columns: LessonColumn[];
  /** Worked-example rows (colName → value) — the concrete instance shown on expand. */
  sample?: Record<string, string>[];
}

// The guided-walkthrough order. Shape-compatible with lib/canvas-tour.ts TourStep (id, title,
// summary, focusIds) plus a narrativeAnchor, so the existing useCanvasTour hook drives it unchanged.
export interface LessonStep {
  id: string;
  title: string;
  summary: string;
  /** Node ids to spotlight for this step; [] frames the whole board (the overview). */
  focusIds: string[];
  /** Heading anchor (lesson-h-N) to scroll the narrative pane to when this step is active. */
  narrativeAnchor?: string;
}

// What a user question is anchored to.
export type LessonQuestionAnchor =
  | { kind: "text"; excerpt: string } // a highlighted span in the narrative
  | { kind: "node"; nodeId: string } // a box on the map
  | { kind: "overall" }; // a top-level question

export interface LessonQuestion {
  id: string;
  anchor: LessonQuestionAnchor;
  question: string;
  /** Filled by the agent in the next round (markdown). Undefined = still open. */
  answer?: string;
  askedAt: number;
  answeredAt?: number;
}

export interface Lesson {
  id: string;
  title: string;
  /** The user's request, verbatim — shown in the library. */
  topic: string;
  createdAt: number;
  /** Bumps strictly-monotonically on every (re)push — the "round" signal the open tab watches. */
  updatedAt: number;
  status: "live" | "saved";

  /** The left-pane narrative — house-style markdown. Backticked real paths become clickable. */
  narrative: string;
  nodes: LessonNode[];
  edges: LessonEdge[];
  /** Database tables the lesson teaches, rendered as annotated schema cards on the same board. */
  tables: LessonTable[];
  steps: LessonStep[];
  /** The running Q&A, accumulated across answer rounds. */
  questions: LessonQuestion[];
}

// A lightweight row for the Lessons library list.
export interface SavedLessonSummary {
  id: string;
  title: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  questionCount: number;
}
