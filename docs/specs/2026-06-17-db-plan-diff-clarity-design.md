# /db plan-diff clarity — show what a MODIFY table actually changes

**Date:** 2026-06-17
**Status:** Design approved (pending written-spec review)

## Problem

On the `/plan` database board, a proposed table that already exists in the live
schema renders a **MODIFY** badge and tints several column rows amber. The board
never says *what* changes about those columns, and — worse — the highlighted
columns are usually **not changing at all**.

Observed case: a plan that only adds a `UNIQUE (from_sequence)` constraint to
`merkle_roots` rendered six amber "modified" columns (`root_hash`,
`from_sequence`, `to_sequence`, `entry_count`, `anchor_status`, `created_at`),
implying column edits the plan never proposed. The actual change (a table
constraint) isn't visible anywhere on the board.

### Root cause (confirmed in code)

The amber stripes are baked in at **proposal time**, then mechanically reported
at **diff time**:

1. `lib/draft-store.ts:graphToDoc` builds every draft column with hard defaults:
   `nullable: c.nullable ?? true`, `isPk: c.isPk ?? false`, `isFk: c.isFk ?? false`.
2. In the propose schemas (`bin/mcp.ts:377-379`, `lib/design.ts:columnSchema`),
   `isPk` / `isFk` / `nullable` are `.optional()`. When the agent re-declares an
   existing table to hang a constraint off it and doesn't restate `nullable` per
   column, each column silently becomes `nullable: true`.
3. The client diff (`components/graph/db-map-client.tsx:475` →
   `lib/db-diff.ts:diffColumns`) compares that defaulted `true` against the live
   `NOT NULL` column and reports `now nullable` → amber "modified".
4. The exact change text *is* computed but is only thrown into the table-level
   `changes` array, surfaced solely in the **MODIFY badge** hover tooltip
   (`components/graph/db-table-node.tsx:261`). Each column row gets a generic
   amber stripe + tooltip `"column changed vs. the live schema"` — no from→to.

Two aggravating facts:

- The draft row UI has **PK and FK toggles but no nullable control**
  (`db-table-node.tsx:313-377`), so a nullable change is invisible on the card —
  the only place it could ever surface is an explicit inline delta.
- The latent (non-visual) consequence: approving such a draft overwrites
  Beacon's column model to `nullable=true` (`draft-store.ts:394-407`), corrupting
  the planning schema until the intel daemon re-syncs from real code.

## Scope (decided with the user)

- **In:** kill phantom MODIFY stripes; show genuine column deltas inline; give
  plan-touched-but-unchanged tables a muted "in plan" signal.
- **Out:** modelling table constraints/indexes (UNIQUE, etc.) as board entities.
  The user explicitly declined this. Constraint intent stays in the plan prose.

## Design

Three parts, smallest blast radius first.

### Part 1 — Correctness: inherit omitted column attrs from the live schema

Eliminate phantom diffs at the source. When `graphToDoc` builds a column for a
table whose **name matches an existing real table**, fill each *unspecified*
optional attribute from the matching live column instead of from a hard default:

```
nullable: c.nullable ?? real?.nullable ?? true
isPk:     c.isPk     ?? real?.isPk     ?? false
isFk:     c.isFk     ?? real?.isFk     ?? false
```

(`name` and `type` are required by the column schema, so only the optional trio
needs inheritance.) A re-declared-but-unchanged column becomes byte-identical to
live → diff = `unchanged` → no stripe. An explicitly-stated change still differs
→ still flagged. This also fixes the latent approve-corruption.

**Mechanism — chosen approach A (inherit at proposal):**

- `graphToDoc(graph, proposedAt, originY, realTables?)` gains an optional
  `realTables: ReadonlyArray<{ name: string; columns: ColLike[] }>` parameter.
  Omitting it preserves today's behavior exactly (tests + back-compat untouched).
- `writeProposal(graph, originY, now, realTables?)` threads it through.
- Its two server callers — `app/api/draft/route.ts:22` and
  `app/api/plan/route.ts:147` — load the live tables+columns (already available
  via the workspace-pinned `db`) and pass them in. Both run server-side with DB
  access, so no new data path is introduced.

Rejected alternatives:
- **B — tri-state through `DraftDoc`** (`boolean | null` = unspecified, diff skips
  null). More correct in theory but invades the doc types, approve Zod schema, and
  card rendering for marginal benefit.
- **C — diff-only (stop comparing nullable/isPk/isFk).** Cheapest but permanently
  discards the ability to show a *genuine* nullability/key change. Rejected.

### Part 2 — Legibility: render the genuine per-column delta inline

The delta is already computed in `diffColumns` and discarded into the table-level
`changes` array. Carry it per-column and render it **in place of the type cell**
on the modified column's row (NOT as a stacked sub-line — that proved cramped and
redundant with the truncated type cell).

- `lib/db-diff.ts`: change `NodeDiff.columns` from
  `Record<string, "added" | "modified">` to
  `Record<string, { kind: "added" | "modified"; detail: string }>`. Two forms of
  the change text: the verbose `edits` (`type bigint→uuid`, …) still feeds the
  table-level `changes` list (the MODIFY-badge hover); a `compact` form feeds the
  inline cell — a type change reads as the bare `old→new` (`text→varchar(120)`),
  flag changes as their phrase (`now nullable`, `now PK`). `added` → `new column`.
- `components/graph/db-table-node.tsx` (draft branch only, where diffs apply):
  - For a **modified** column, the right-hand cell renders the amber `detail`
    (non-editable) instead of the type input — so the from→to sits exactly where
    you look for the type, with no second line and no redundant truncated type.
  - **Robust layout (name never crops; the delta cell gives way):** the column
    name input is content-width + `shrink-0`; a `flex-1` spacer follows it; the
    right cell (type input / fk target / amber delta) is `min-w-0 shrink truncate`.
    A long name OR a long delta makes the delta ellipsize (full text on hover),
    never overflowing the card and never cropping the name — the same contract the
    type cell always followed.
  - `contentFitWidth` grows the card (clamped to 312px) to fit name + delta so a
    normal delta shows in full; only extremes truncate. Added column → type tinted
    green (signals "new" alongside the green inset stripe); modified → amber stripe.
- `db-map-client.tsx:670` already forwards `.columns`; only the value shape
  changes, so update the passthrough/read sites accordingly.

The non-draft (live `/map` Database tab) card path is untouched — diffs are
computed only for the embedded `/plan` board (`db-map-client.tsx:475`).

### Part 3 — "in plan" signal for unchanged-but-proposed tables

A draft table with no column delta is still part of the plan (it's in the draft
doc). Today that renders a sky-blue `draft` badge. Make it read clearly as
plan-touched-but-unchanged, distinct from MODIFY/NEW.

- `db-table-node.tsx:108`: the `diffLabel` for the `unchanged`/default case
  becomes `"in plan"` (was `"draft"`), rendered in a muted tone (not the amber
  modify accent, not the green new accent) so it reads as "participates in this
  plan, no column-level change." `added` → `new`, `modified` → `modify` unchanged.

After all three parts, the `merkle_roots` example renders: a muted **IN PLAN**
tag, every column plain (no phantom stripe), and the `UNIQUE` constraint
described in the plan prose on the left — honest and un-alarming.

## Testing (TDD — write first, watch fail)

`bun test`. New/extended tests:

- **`tests/db-diff` (Part 2 + correctness surface):**
  - A draft column that re-declares an existing column but omits `nullable`
    against a live `NOT NULL` column produces **no** modified entry (after the
    Part 1 inherit feeds an accurate draft) — i.e. unchanged.
  - A genuine retype (`bigint`→`text`) yields
    `columns[name] = { kind: "modified", detail: "type bigint→text" }`.
  - A nullable flip and a PK flip each yield the right `detail` string.
  - A new column yields `{ kind: "added", detail: "new column" }`.
- **`tests/draft-store` (Part 1):**
  - `graphToDoc(graph, …, realTables)` with a column omitting `nullable`/`isFk`
    inherits the real column's values; an explicitly-set value overrides;
    a column with no real match falls back to today's defaults.
  - Omitting `realTables` reproduces current output byte-for-byte (back-compat).
- **Manual /plan verification (Playwright MCP):** re-open the merkle_roots plan
  on `/plan`; confirm no phantom stripes, the "in plan" tag, and that a
  deliberately-retyped column shows its inline delta.

## Files touched

- `lib/draft-store.ts` — `graphToDoc` + `writeProposal` gain `realTables`.
- `app/api/draft/route.ts`, `app/api/plan/route.ts` — load + pass live tables.
- `lib/db-diff.ts` — `NodeDiff.columns` carries `{ kind, detail }`.
- `components/graph/db-table-node.tsx` — inline delta chip, `NEW` chip,
  "in plan" badge.
- `components/graph/db-map-client.tsx` — passthrough shape update.
- `tests/` — db-diff + draft-store coverage above.

## Out of scope / follow-ups

- Modelling constraints/indexes as first-class board entities.
- Surfacing *removed* columns when the agent re-declares a table with a partial
  column list (a related but separate failure mode; not triggered here).
