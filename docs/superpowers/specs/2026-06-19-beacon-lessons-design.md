# Beacon Lessons — a visual learning surface for your architecture

**Date:** 2026-06-19
**Status:** Design — awaiting review
**Author:** terminal session + Wenzo

---

## 1. Goal

Give the terminal agent a way to **explain** part of an existing codebase to the user
**visually and interactively**, separate from the plan-review flow (plans are for *building*;
this is for *understanding*).

When the user asks *"teach me how the plan loop works"* or *"explain the INTEL category,"* the
agent authors a **Lesson**: a curated map of the relevant pieces — boxes joined by labeled
arrows — paired with a plain-English narrative written in a specific house style. It opens on a
new `/learn` page. The user reads, **highlights any text to ask a question**, **drops question
notes** on the map, and the agent answers right there — looping until the user clicks **Save**,
at which point the Lesson lands in a library they can reopen forever.

This is deliberately a recombination of surfaces Beacon already has, plus one new MCP tool and
one new skill. Most of the mechanical layer (split-screen, highlight-to-comment, clickable
files, React-Flow canvas, guided tour, the blocking-verdict loop, per-workspace JSON
persistence) already exists and is reused.

### Non-goals

- Not a chatbot. The conversation is the terminal session; `/learn` is its eyes and hands.
- Not auto-generated. Beacon never writes a Lesson on its own — the agent authors it.
- No approve/discard verdict. The only terminal action is **Save** (or close without saving).
- v1 does not touch the real `/map` or `/db` boards — a Lesson references them, never mutates them.

---

## 2. The Explanation Rubric (the house style the skill teaches)

This is the heart of the feature. The user supplied a gold-standard example (the "Order ERP
Sync Engine — outbound lifecycle + the audit ledger" writeup). The `beacon-explain` skill must
teach the agent to explain **like that**. The rubric, distilled from it:

1. **Plain English, always.** Explain like teaching a sharp person who is new to *this* code.
   Define any term the first time it appears. No unexplained jargon, no wall of nouns.

2. **Problem-first.** Open each component with **"The problem it solves"** — a concrete, human
   scenario (*"When a salesperson confirms an order…"*), the tension that forced the design
   (*"the ERP can be slow, down, or reject the order, and you do not want confirmation to
   hang"*), then the decision (*"so the sync is decoupled"*) and what it means.

3. **Concrete step-by-step flow.** Walk the real path with a numbered list. Each step is one
   clear action and **names the real identifier inline in backticks** — file
   (`order-placed-sync-erp.ts`), function (`syncOrderToErpWorkflow`), event (`order.placed`),
   column (`erp_sync_record`), value (`requires_human_action`). Enumerate the cases
   (success / retryable / rejected / ambiguous) with the plain-English meaning of each.

4. **Anticipate-and-answer "Why X?".** After the flow, add short sections that answer the
   confusions a reader will actually have: *"Why two status columns?"*, *"Why the ledger is
   append-only?"*, *"Why one shared lock?"*. Each one **explains why the alternative is worse**
   (*"claiming success could hide a real failure; claiming hard failure could cause a duplicate
   order later"*). This is the elaborative-interrogation principle made into prose.

5. **A worked example with real data.** Show the mechanism running on one concrete case —
   ideally a small **table** of state transitions (attempt 1–6 → 7 → operator fixes) — and land
   the insight (*"That's 8 rows for one order — and that's the point"*).

6. **Typographic discipline.** **Bold** the decisions and load-bearing words; *italic* for key
   concepts being introduced; `inline code` for every real identifier (these also become
   clickable file mentions, see §7).

7. **Map the prose to the board.** Every component/flow named in the narrative should be a node
   on the right, and every "A does X to B" should be a labeled arrow. The narrative and the map
   are the two channels of dual coding — they reinforce, they don't merely duplicate (the map
   carries *structure*; the prose carries *why*).

The skill ships this rubric verbatim (with the ERP example as a few-shot exemplar) so every
Lesson reads like the gold standard.

---

## 3. Surfaces & naming

| Thing | Name |
|---|---|
| Page | `/learn` |
| Artifact | a **Lesson** |
| MCP tool | `beacon_explain` |
| Skill | `beacon-explain` |
| Library | **Lessons** (saved lessons, browsable like plan history) |

Per-workspace files under `~/.beacon/<id>/` (mirrors the plan flow's on-disk store):

| File | Role |
|---|---|
| `lesson-current.json` | the live Lesson being explained (the "draft") |
| `lesson-verdict.json` | the verdict signal the MCP poll reads (`pending`/`questions`/`saved`/`closed`) |
| `lesson-questions.json` | in-progress questions the user is accumulating (analog of `plan-annotations.json`) |
| `lessons/<lesson-id>.json` | a saved Lesson in the library |

No new Drizzle tables. Lessons are portable JSON documents, exactly like archived plans
(`lib/plan-history.ts` writes `plans/history/<id>.json`).

---

## 4. Data model — the Lesson document

```ts
// lib/lesson-types.ts  (client-safe: no node:fs)
interface Lesson {
  id: string;                 // 8-char slug, like archived plans
  title: string;              // e.g. "How a plan flows to /plan"
  topic: string;              // the user's request, verbatim, for the library
  createdAt: number;
  updatedAt: number;
  status: "live" | "saved";

  // The left-pane narrative — the house-style markdown (§2). Backticked real paths become
  // clickable file mentions (§7).
  narrative: string;

  // The right-pane concept map.
  nodes: LessonNode[];
  edges: LessonEdge[];

  // The guided walkthrough order. Each step spotlights some nodes and (optionally) scrolls the
  // narrative to a heading anchor. Drives the existing useCanvasTour machinery (§8).
  steps: LessonStep[];

  // Q&A accumulated across rounds. Answered questions render under their card on the board.
  questions: LessonQuestion[];
}

interface LessonNode {
  id: string;
  title: string;              // box face
  summary: string;            // one-line plain-English summary on the face
  detail: string;             // fuller plain-English explanation, expand-on-demand (markdown)
  files: string[];            // real repo-relative paths → clickable chips on the node
  group?: string;             // optional cluster label (for landmark regions)
  x: number; y: number;       // laid out ONCE, then frozen (§ research #5)
}

interface LessonEdge {
  id: string;
  fromId: string; toId: string;
  // Controlled vocabulary — a relationship VERB, never a bare line (§ research #4).
  verb: "imports" | "calls" | "persists to" | "reads from" | "writes to"
      | "routes to" | "depends on" | "emits" | "returns" | "contains" | "extends";
}

interface LessonStep {
  id: string;
  title: string;              // step label in the walkthrough rail
  summary: string;            // one or two sentences shown in the overlay
  focusIds: string[];         // node ids to spotlight; [] = frame the whole board (overview)
  narrativeAnchor?: string;   // heading anchor to scroll the left pane to (lesson-h-N)
}

interface LessonQuestion {
  id: string;
  anchor:                     // what the question is about
    | { kind: "text"; excerpt: string }       // highlighted narrative span
    | { kind: "node"; nodeId: string }         // a box on the map
    | { kind: "overall" };                     // a top-level question
  question: string;
  answer?: string;            // filled by the agent in the next round (markdown)
  askedAt: number;
  answeredAt?: number;
}
```

`LessonStep` reuses the exact shape of the existing `TourStep` (`lib/canvas-tour.ts`:
`{ id, kind, title, summary, focusIds }`) plus a `narrativeAnchor`, so the existing
`useCanvasTour(steps, onFocusStep)` hook drives it unchanged.

---

## 5. The `/learn` page (forks the `/plan` split-screen)

`components/plan/plan-workspace.tsx` is the template. A new
`components/learn/learn-workspace.tsx` keeps its skeleton and drops the plan-only parts:

**Reused as-is:**
- Resizable split panes + persisted `leftPct` (localStorage key `beacon:learn-left-pct`).
- `FileMentionProvider` wrapping the left pane → clickable files (§7).
- The presence heartbeat (so the `beacon_explain` re-push refreshes the open tab instead of
  spawning a new one).
- The "agent is working" waiting overlay (shown after the user sends questions — identical to
  the plan's "Feedback sent" overlay, relabeled "Answering your questions…").

**Left pane — the narrative.** A `LessonNarrativePanel` adapted from `AnnotationPanel`:
- Same CSS-Highlight text-selection flow, but **comment → question**. Highlighting opens the
  composer with placeholder *"Ask the agent about this…"*. The deletion ("mark for removal")
  affordance is dropped — irrelevant to learning.
- The top-level **"Overall feedback"** textarea becomes **"Ask an overall question"** (the
  user's explicit ask: *"asking an overall question at the top, like the plan page"*).
- Saved questions paint as highlights (orange), exactly like saved plan annotations. When the
  agent answers, the highlight gets a small marker and the answer shows in the questions list /
  on the node card.

**Right pane — the lesson map.** A new `components/graph/lesson-map-client.tsx` (a trimmed
sibling of `map-client.tsx`):
- React-Flow board of `LessonNode` cards + labeled `LessonEdge` arrows. Node face = title +
  one-line summary; click expands `detail` (tethered, not a far panel — research #3).
- Edges render with the verb as the edge label (reusing the existing labeled-edge styling).
- Layout runs once on first receipt, positions persist in the Lesson; never re-flowed
  (research #5). (The agent may supply `x/y`; if absent, a one-time layered layout — same
  `lib/layered-layout.ts` used by the arch board — assigns them and we save them back.)
- Question notes are orange annotation cards anchored to their node/excerpt — reusing
  `components/graph/annotation-node.tsx` + `lib/annotation-anchors.ts`. Each node has an **Ask**
  button (the `onAskAgent` prop already exists on `MapClient`) that opens the question composer
  pre-targeted to that node.
- The guided-walkthrough overlay (§8) sits over this canvas.

**Top-right controls pill** (adapted from the plan pill): **Send questions** (was Submit),
**Save** (was Approve — persists to the library and ends the loop), **Close** (was Discard —
ends without saving), **Ask** (the question composer toggle), **Start walkthrough**, **Library**
(was plan history), **Share** (phase 2).

---

## 6. The blocking question→answer loop (mirrors `beacon_propose_plan`)

Verified mechanics being mirrored:
- `bin/mcp.ts` `beacon_propose_plan` POSTs to `/api/plan`, opens the tab, then polls
  `/api/plan/verdict` every `PLAN_POLL_INTERVAL_MS` (1500ms) up to `PLAN_TOOL_TIMEOUT_MS`
  (30 min), returning text per verdict.
- `lib/plan-verdict.ts` persists `plan-verdict.json`; `lib/plan-resolve.ts::resolvePlanVerdict()`
  resolves priority `feedback > approved/discarded > pending`.
- `app/api/plan/annotations` POST stores submitted feedback (incl. the existing
  `questions: {target, question}[]` field already plumbed through `getExtraSubmitPayload`).

The Lesson loop, modeled on it:

1. **Agent** calls `beacon_explain(lesson)` → `POST /api/lesson` writes `lesson-current.json`,
   bumps version (live-refresh shows it), opens/refreshes the `/learn` tab. The tool then polls
   `GET /api/lesson/verdict` on the same interval/timeout.
2. **User** reads, highlights → asks, drops node questions, asks an overall question. These
   accumulate in `lesson-questions.json` via `POST /api/lesson/questions` (autosave, like the
   annotation PUT).
3. **User clicks "Send questions"** → marks the questions submitted. Verdict resolves to
   `{ kind: "questions", questions: LessonQuestion[] }`. The poll unblocks and the tool returns
   the questions (rendered to markdown by a new `lib/lesson-feedback.ts::renderQuestions()`,
   styled after `renderFeedback`) to the agent.
4. **Agent** answers each question (fills `answer`, may add/expand nodes or narrative) and calls
   `beacon_explain` again with the updated Lesson → re-push, version bump, the `/learn` tab
   re-hydrates in place (the proposedAt-style monotonic `updatedAt` is the round signal). The
   answer appears under each question card and in the narrative.
5. Repeat until **User clicks "Save"** → `POST /api/lesson/save` writes
   `lessons/<id>.json`, verdict resolves `{ kind: "saved", lessonId }`, the tool returns "saved"
   and the agent stops. **Close** → `{ kind: "closed" }`, also terminal (no save).

Verdict shape (`lib/lesson-verdict.ts`):
```ts
type LessonVerdict =
  | { kind: "pending" }
  | { kind: "questions"; questions: LessonQuestion[] }
  | { kind: "saved"; lessonId: string }
  | { kind: "closed" };
```

New endpoints (all pinned via `runWithWorkspace`, browser routes via `pinned()` — per repo
convention): `POST /api/lesson`, `GET /api/lesson/verdict`, `GET|POST /api/lesson/questions`,
`POST /api/lesson/save`, `POST /api/lesson/close`, `GET /api/lesson/library`,
`GET /api/lesson/library/[id]`.

---

## 7. Clickable files (same system as `/plan`)

No new mechanism. `components/plan/markdown-view.tsx` already linkifies any backticked token
that matches a real repo file via `lib/file-mention.ts` (`buildFileIndex` / `resolveFileToken`),
gated behind `FileMentionProvider` which is fed the workspace's repo file list. The `/learn`
narrative pane is wrapped in the same `FileMentionProvider files={repoFiles}` and renders through
the same `Inline`/`MarkdownView`, so:
- Backticked real paths in the narrative → clickable, open-in-editor (ambiguous bare names →
  pick-one dropdown). Exactly like the plan page.
- `LessonNode.files[]` render as clickable chips on each node card (the node card already shows
  attached files on the arch board — reuse that affordance).

Because the rubric (§2.3, §2.6) tells the agent to name every identifier in backticks, clickable
mentions appear densely and for free.

---

## 8. Guided walkthrough (v1 — reuses `useCanvasTour`)

Verified machinery: `lib/canvas-tour.ts` defines `TourStep { id, kind, title, summary,
focusIds }` and builders (`buildArchTour`, `buildFileTour`); `components/graph/use-canvas-tour.ts`
manages `active/index/step/focusIds` with `start/stop/next/prev/goto` + arrow-key nav and fires
`onFocusStep` (viewport animation); `components/graph/tour-overlay.tsx` renders the step rail +
Prev/Next. The canvas dims nodes not in `focusIds`.

For Lessons:
- The agent supplies `Lesson.steps` directly (it knows the pedagogical order — no auto-builder
  needed, though a fallback `buildLessonTour` can derive overview→nodes-in-edge-order if steps
  are omitted).
- `lesson-map-client.tsx` calls `useCanvasTour(lesson.steps, onFocusStep)` and, on each step,
  (a) spotlights `focusIds` (dim the rest — the segmenting + signaling principle), (b) frames
  them in the viewport, and (c) scrolls the left narrative to `step.narrativeAnchor`.
- Reuse `TourOverlay` (possibly lightly restyled as `LessonOverlay`) for the Prev/Next rail.
- Default behavior on lesson open: **show the overview, prompt "Start walkthrough"** (guided
  first, free-pan second — research #2). Free panning stays available.

---

## 9. The `beacon_explain` MCP tool

Added to `bin/mcp.ts`, modeled on `beacon_propose_plan`. Input schema (Zod):
```ts
beacon_explain({
  title: string,
  topic: string,                 // the user's question
  narrative: string,             // house-style markdown
  nodes:  LessonNode[],          // (x/y optional — auto-laid-out once if absent)
  edges:  LessonEdge[],
  steps?: LessonStep[],          // walkthrough order; derived if omitted
  answers?: { questionId: string; answer: string }[],  // on re-push rounds
})
```
Behavior: POST `/api/lesson`, activate workspace, open/refresh tab, poll `/api/lesson/verdict`.
Returns:
- `questions` → the rendered question markdown, instructing the agent to answer and re-call
  `beacon_explain` with `answers` + any expanded nodes/narrative.
- `saved` → confirmation; the agent stops.
- `closed` → the user closed it; the agent stops and may ask if they want to continue.

The tool **description** carries a compressed form of the §2 rubric so Codex/Cursor (which don't
see skills) still produce house-style lessons (per the cross-client memory:
fixes for CC+Codex+Cursor go in MCP tool descriptions + AGENTS.md, not only skills).

---

## 10. The `beacon-explain` skill

A new skill string in `lib/assets.ts` (`EXPLAIN_SKILL`), an `installExplainSkill(repo)` helper,
and `"beacon-explain"` added to `GLOBAL_SKILLS` in `lib/agent-config.ts`. Install/heal/audit then
happen automatically via the existing registry (`selfHealGlobal()` runs on every `beacon mcp`).

Skill content:
- **Trigger:** the user says *"teach me / explain / walk me through / how does X work / help me
  understand the Y category."*
- **Step 1 — load context first** (never explain blind): `beacon_context_for_feature` /
  `beacon_map` / the code graph for the topic.
- **Step 2 — author the Lesson** following the §2 rubric **verbatim**, with the ERP writeup as a
  few-shot exemplar. Emphasize: plain English; problem-first; concrete numbered flow naming real
  backticked paths; "Why X?" sections that beat the alternative; a worked example with a data
  table; map every named piece to a node + labeled arrow; supply a sensible walkthrough order.
- **Step 3 — push** via `beacon_explain`, then **answer the user's questions** in the blocking
  loop until they Save. Each answer must *add* understanding (rationale, trade-off), not restate
  the question (research: self-explanation/dual-coding).

The AGENTS.md project block (generated by `lib/context-files.ts`) gets a short "Explaining
architecture" subsection mirroring the trigger + rubric pointer, for cross-client reach.

---

## 11. Saving & the Lessons library

- **Save** writes `lessons/<id>.json` and flips `status: "saved"`. The verdict returns `saved`.
- A **Lessons** view on `/learn` (built like `components/plan/plan-history-view.tsx`) lists saved
  lessons (topic, title, date), newest first. Clicking one reopens the full Lesson — narrative +
  frozen map + Q&A — read-only-ish (you can still re-run the walkthrough; re-engaging the agent
  for new questions requires a live session and is a phase-2 nicety).
- Phase 2: share a Lesson read-only via the existing `/s/<token>` snapshot system
  (`lib/share-builder.ts`).

---

## 12. Research principles → where each lands

| Principle (evidence) | In the design |
|---|---|
| #1 Highlight → generative question (Dunlosky) | Highlighting always opens "Ask the agent"; no bare highlights (§5) |
| #2 Guided segmented walkthrough, d=0.98 (Mayer/segmenting) | `useCanvasTour` reveal one node/step at a time; guided-first (§8) |
| #3 Explanation tethered to its node | `detail` expands on the node; narrative + map dual-coded (§5) |
| #4 Labeled directional arrows (Novak; Nesbit & Adesope) | `LessonEdge.verb` controlled vocabulary, never bare lines (§4) |
| #5 Freeze positions (Data Mountain; method of loci) | Layout once, persisted in the Lesson, never re-flowed (§4, §5) |
| #6 Overview-first, ~4 chunks (Shneiderman; Cowan; C4) | Overview step first; curated node set, not the whole real map (§8) |
| #7 / elaborative interrogation (self-explanation ~3×) | Rubric's "Why X?" sections; answers add rationale not paraphrase (§2, §10) |

Managed tension (research): crossing-minimization vs frozen layout — for a revisitable learning
board, **stability wins**: optimize layout once at creation, then freeze.

---

## 13. Reuse map — what's new vs. reused

**Reused (little/no change):**
- `components/plan/markdown-view.tsx` + `lib/file-mention.ts` — narrative rendering + clickable
  files.
- `components/graph/use-canvas-tour.ts`, `tour-overlay.tsx`, `lib/canvas-tour.ts` — walkthrough.
- `components/graph/annotation-node.tsx`, `lib/annotation-anchors.ts` — question note cards.
- `lib/layered-layout.ts` — one-time layout for nodes lacking x/y.
- Live-refresh SSE (`app/api/stream`, `components/live-refresh.tsx`) — re-push refresh.
- The blocking-loop pattern from `bin/mcp.ts` / `lib/plan-verdict.ts` / `lib/plan-resolve.ts`.
- Skill install registry (`lib/assets.ts`, `lib/agent-config.ts`, `lib/global-install.ts`).

**New:**
- `lib/lesson-types.ts` (client-safe types), `lib/lesson-store.ts` (disk CRUD),
  `lib/lesson-verdict.ts`, `lib/lesson-resolve.ts`, `lib/lesson-feedback.ts` (render questions).
- `app/learn/page.tsx`, `components/learn/learn-workspace.tsx`,
  `components/learn/lesson-narrative-panel.tsx` (forked from annotation-panel),
  `components/graph/lesson-map-client.tsx`, `components/learn/lesson-library-view.tsx`.
- API routes under `app/api/lesson/*`.
- `bin/mcp.ts` — the `beacon_explain` tool.
- `lib/assets.ts` `EXPLAIN_SKILL` + `lib/agent-config.ts` `GLOBAL_SKILLS` entry; AGENTS.md block
  subsection in `lib/context-files.ts`.
- Top-nav entry for `/learn`.

---

## 14. Scope

**v1:** `/learn` split-screen; authored map + house-style narrative; clickable files;
highlight-to-ask + node question notes + overall question; blocking answer loop; guided
walkthrough; Save + Lessons library; `beacon_explain` tool + `beacon-explain` skill + AGENTS.md
block.

**Phase 2:** "explain-it-back" prompts (user writes the why in their words, saved on the node);
share a Lesson read-only via `/s`; re-engaging the agent from a saved Lesson.

---

## 15. Testing (TDD, `bun test`)

- `lib/lesson-store.ts` — write/read/save/list round-trips per workspace.
- `lib/lesson-verdict.ts` / `lib/lesson-resolve.ts` — pending → questions → saved/closed
  resolution + priority, mirroring `tests/plan-*` patterns.
- `lib/lesson-feedback.ts` — `renderQuestions()` markdown shape (text/node/overall anchors).
- `bin/mcp.ts` `beacon_explain` — push + poll + verdict return (mirror `tests/feature-loop.test.ts`).
- Skill/install — `beacon-explain` appears in `GLOBAL_SKILLS`, installs, audits, uninstalls
  (extend `tests/codex-install.test.ts` / global-install coverage).
- Step→node spotlight + narrative anchor wiring (component-level where feasible).

---

## 16. Open questions / risks

1. **Top nav placement** — is `/learn` a top-level nav item beside Map/Database/Plan, or nested?
   (Default: top-level, behind the existing nav.)
2. **Naming** — "Lesson" / `/learn` / `beacon_explain` / `beacon-explain`. Adjust if preferred.
3. **Auto-layout vs agent-supplied positions** — default to agent-supplied when present, else a
   one-time layered layout, then freeze. Confirm that's acceptable.
4. **Schema portability** — staying file-based (no Drizzle tables) keeps the schema
   Postgres-portable and avoids migrations; revisit only if the library needs querying.
