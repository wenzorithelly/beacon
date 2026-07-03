# Changes view redesign — Mission Control

Approved on /plan 2026-07-03 (plan history holds the annotated round). Feature ids:
`pdrqxvh8f3zwgc9a9g6dbtjg` (Mission Control), `d9r4h33oga94e0s0b3ud6yqp` (Comments v2),
`asf1el4cymjd83k6x18dcu8e` (Quality & duplication signals).

## Decisions (from brainstorming)

- **Mode**: monitoring AND review are equal citizens — two lenses over one dataset.
- **Comments**: instant delivery by default, per-comment Hold to batch.
- **At a glance**: what's the agent doing now · size/risk · what have I reviewed · quality +
  duplication signals. (On-plan progress was explicitly NOT prioritized for the glance layer.)
- **Quality/duplication sources**: deterministic only — git, touched-files, code graph, repo's own
  linter, token-fingerprint clone detection. No AI calls in the loop.
- **Approach**: "Mission Control" chosen over "Refined two-pane" and "Checkpoint stream"
  (checkpoint/patchset model deferred; can layer on later).

## Research basis (agents read primary sources 2026-07-03)

Cognitive: working memory holds 3–5 chunks (Cowan) → chunk by intent, ~4 groups per level.
Overview first, zoom/filter, details on demand (Shneiderman); exactly two disclosure levels
(NN/g progressive disclosure). One visual channel per meaning (Gestalt common region; preattentive
conjunction failure). Verb-first left-edge microcopy (F-pattern) paired icon+label (dual coding).
Episode boundaries at goal changes are memory anchors (Event Segmentation Theory). Re-renders are
the flicker paradigm — changes landing across one are invisible (Simons & Rensink change
blindness); every mutation needs a location transient + persistent unseen marker.

Code review: rationale is the #1 reviewer need (Bacchelli & Bird ICSE'13); risk ("does this break
code elsewhere?") and consistency are the hardest (Tao FSE'12). Review is skim-then-drill —
scattered/inconsistent edits cost ~6× deliberation (Begel & Vrzakova eye-tracking). ~400 changed
LOC is the attention budget (SmartBear/Cisco). File order is a review instrument: last-position
files have ~64% lower bug-found odds (Fregnan) — never alphabetical. Agent-supervision consensus
(Devin/CodeRabbit/Codex): summary-first walkthrough → grouped hunks → line-anchored context →
comment-becomes-agent-context.

## Information architecture

Overview screen (default) → per-file diff detail. Two lenses, one dataset:

- **Activity lens** (monitoring): cards grouped into 3–5 episodes by clustering
  `touched-files.json` `lastAt` timestamps (>5 min gap = new episode): "Now", "Earlier this
  session", "Before this session". Newest first.
- **Review lens** (auditing): importance-first ordering = diff size × importer count
  (`CodeFile.inDegree`, already maintained by intel). Tests adjacent to their code;
  config/lockfiles/generated last, auto-folded.

Visual channels: card boundary = chunk · hue = change kind · motion = ONLY "new since you looked"
· orange #ff7a45 = comments/agent attention.

## Phase A — Mission Control layout (feature pdrqxvh8f3zwgc9a9g6dbtjg)

**Overview strip**: live activity line verb-first (`● Editing lib/plan-resolve.ts · 12s ago`,
pulses only while edits land); magnitude `9 files · +412 −180` with subtle ~400-LOC budget bar
(nudge, never a blocker); `3 unseen · 4/9 viewed`; `Activity | Review` lens toggle.

**File cards** (skim layer): verb-first `Edited lib/plan-resolve.ts +14 −6` + mini ± bar;
symbols touched `↳ approvePlan, writeContract` parsed from git hunk headers in ONE full-diff pass
per refresh (replaces the separate --name-status/--numstat calls in `lib/changes.ts`; same pass
classifies formatting-only hunks); risk chip `⚠ 12 importers` from inDegree; GitHub-style viewed
checkbox that AUTO-INVALIDATES when the agent re-edits after viewing (new `lib/viewed-files.ts`,
disk store patterned on `lib/touched-files.ts`, stores viewedAt + content signature); comment
count chip.

**Change-blindness fixes**: arriving/updated cards get a brief highlight transient at location +
persistent unseen dot until opened/viewed. No silent list swaps. Motion reserved for this alone.

**Detail view**: existing react-diff-view pane + `markEdits` word-level emphasis +
formatting-only hunks folded by default + back-nav preserving overview scroll/lens.

## Phase B — Comments v2 (feature d9r4h33oga94e0s0b3ud6yqp)

- Hover-`+` gutter button; drag multi-line ranges; comment on unchanged/context lines.
- **Content anchoring**: store trimmed line text + surrounding context hash; re-anchor by content
  each refresh. If anchored code changed → explicit "agent changed this since your comment" state
  with original excerpt (supervision happy path, not an edge case).
- **Lifecycle**: comments belong to the plan round; archived on approve/discard in
  `lib/plan-resolve.ts`; never resurrected on later plans.
- **Hold-to-batch**: store gains `held` flag the claim skips; release-all control.
- **One guard fetch**: merge comment claim into `app/api/scope-guard/check/route.ts` response
  (decision + additionalContext); `bin/guard.ts` makes ONE request per edit.
- Split-view side fix: use clicked side from the diff event, not change-type inference.

## Phase C — Quality & duplication signals (feature asf1el4cymjd83k6x18dcu8e)

- Instant per-file cues from the same diff pass: added-function length, nesting depth, added
  TODO/console.log/any counts → compact chips.
- Lint chip: repo's own linter on changed files only, debounced + mtime-cached, only when config
  exists; never blocks rendering.
- Clone detection: new `intel/extractors/clone-fingerprints.ts` (winnowed k-gram token shingles
  over repo files, per-workspace store) + `lib/clone-detect.ts` matching added hunks → `≈ resembles
  lib/x.ts:40–60` chip. Defaults: k=8-token shingles, winnow window 4, only hunks ≥ 40 added
  tokens, report matches ≥ 2 consecutive fingerprints (tunable constants in one place).

## Testing

TDD (`bun test`): episode clustering, importance ordering, symbol extraction, formatting-only
classification, content re-anchoring, viewed invalidation, fingerprint matching — pure functions,
unit-tested. Extends `tests/changes.test.ts`, `tests/diff-comments.test.ts`; new
`tests/changes-order.test.ts`, `tests/viewed-files.test.ts`, `tests/clone-detect.test.ts`.

## Shipping

Three independent slices (A alone is the assimilation win; B and C layer on without rework).
Small conventional commits per slice.
