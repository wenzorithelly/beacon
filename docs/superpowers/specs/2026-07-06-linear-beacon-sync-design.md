# Linear ↔ Beacon two-way sync — design

**Date:** 2026-07-06
**Status:** implemented (approved on /plan; 26 tests green, uncommitted)

## Problem

Wenzo repeatedly creates a ticket in Linear, then re-enters the same item as a
Beacon roadmap card. Double entry. Goal: one edit propagates both ways, and a
synced Beacon card can be opened in Linear.

Decisions locked with the user:
- **Full field write-back**, last-writer-wins by `updatedAt`.
- **One Linear team per Beacon workspace.**
- Must be able to **open a synced card in Linear**.

## The hard constraint (why not webhooks)

Linear webhooks require "a publicly accessible HTTPS, non-localhost URL" (verified
in Linear's docs). Beacon is a localhost daemon with a per-workspace SQLite file —
no public URL. So inbound is a **delta poll**, not a webhook. Auth is a Linear
**personal API key** (`Authorization: <key>` → `https://api.linear.app/graphql`) —
no OAuth app, no callback, no hosted piece.

**Tradeoff:** ~60s propagation instead of instant. Everything else (both-way, all
fields) survives. Upgrade path to <1s = a tunnel/relay feeding a webhook endpoint;
deferred.

## Architecture

One reconcile loop, both directions, no per-mutation hooks:

```
every ~60s, for each workspace with Linear enabled:
  1. fetch Linear delta:  issues(filter:{ updatedAt: { gt: lastCursor } }) for the team
  2. load local nodes where source = "LINEAR"
  3. reconcile the union (LWW) — see algorithm below
  4. advance lastCursor = max Linear updatedAt seen
```

The loop lives in `lib/linear/daemon.ts`, started from `instrumentation.ts`
**before** the `NODE_ENV === "production"` early-return (same slot as
`startTelemetry`) so it runs in the packaged `next start` daemon, not just dev.
Pattern mirrors `lib/telemetry.ts`: `globalThis` dedupe flag +
`setInterval(...).unref()`. Iterates workspaces via `listWorkspaces()` /
`getWorkspace()` (as `intel/watch-manager.ts` does) and pins each with
`runWithWorkspace(id, …)` before touching `db`.

Write-back is **part of the same reconcile pass** — a node whose local edit is
newer than Linear gets pushed via `issueUpdate`. No status/priority mutation hooks
scattered through `lib/map-ops.ts`.

## Data model (almost nothing new)

`Node` already has `externalId`, `sourceRef`, `source` (default `"MANUAL"`;
existing values DRAFT/SESSION/INIT/INTROSPECTION). Reuse:

| column        | holds                                                    |
|---------------|----------------------------------------------------------|
| `source`      | `"LINEAR"` — marks a synced card                         |
| `externalId`  | Linear issue UUID (stable id for `issueUpdate` mutations)|
| `sourceRef`   | Linear issue `url` (→ "Open in Linear ↗"; identifier is its last path segment) |

**New columns on `Node` (the only migration):**
- `externalUpdatedAt` `integer timestamp_ms` nullable — last Linear `updatedAt` mirrored (detects Linear-side change).
- `externalSyncedAt` `integer timestamp_ms` nullable — wall-clock of last reconcile write (detects Beacon-side change; needed because an inbound apply bumps `Node.updatedAt` via `$onUpdate`, which would otherwise look like a user edit next tick).

**Connection state** → reuse `WorkspaceFlag` (`key = "linear"`, `enabled`, `config` JSON):
```json
{ "apiKey": "lin_api_…", "teamId": "…", "teamKey": "V3",
  "orgUrlKey": "acme", "lastCursor": "2026-07-06T12:40:00Z",
  "stateMap": { "PENDING": "<linear stateId>", "IN_PROGRESS": "…", "DONE": "…", "CANCELLED": "…" } }
```
`stateMap` is resolved once from the team's workflow states (Linear state ids are
per-team UUIDs) so write-back can set the right target state. API key stored
locally under `~/.beacon/<id>/` like all workspace data — not in the repo.

No new table. No `tables[]` in the plan block — this is a code + 2-column-migration
plan, not a new-schema plan.

## Field mapping (`lib/linear/mapping.ts`, pure functions)

| Linear                       | Beacon                                            |
|------------------------------|---------------------------------------------------|
| state type `triage/backlog/unstarted` | status `PENDING`                         |
| state type `started`         | status `IN_PROGRESS`                              |
| state type `completed`       | status `DONE`                                     |
| state type `canceled`        | status `CANCELLED`                               |
| priority 1 Urgent / 2 High / 3 Med / 4 Low / 0 None | priority 0 / 1 / 2 / 3 / 2 |
| `title`, `description`       | `title`, `plain`                                  |
| parent issue → child issues  | parent Node + sub-task Nodes (`parentId`)         |
| label named `bug`            | `kind = "BUG"`                                     |
| team/project name            | `cluster` (category) — default team key, else project |
| `url`                        | `sourceRef`                                        |

`layer`: Linear has no layer. Default `"fullstack"` (workspace hasFrontend);
overridable later via a label convention. Pure maps ⇒ trivially unit-testable.

## Reconcile algorithm (LWW, per linked node)

```
linearChanged = issue.updatedAt > node.externalUpdatedAt
beaconChanged = node.updatedAt   > node.externalSyncedAt

if linearChanged && !beaconChanged            → apply issue → node
elif beaconChanged && !linearChanged          → push node → issue (issueUpdate)
elif linearChanged && beaconChanged            → LWW: newer updatedAt wins
else                                           → no-op

after any write: node.externalUpdatedAt = resulting issue.updatedAt
                 node.externalSyncedAt  = now
```

- **New Linear issue, no local node** → create a `source="LINEAR"` node. This is
  what kills the double-entry: the agent creates a Linear issue, the card appears
  ≤60s later on its own.
- **Echo suppression:** a Beacon→Linear push bumps Linear's `updatedAt`; next tick
  `linearChanged` is true but the field values already match, so the apply is a
  no-op and `externalUpdatedAt` catches up.
- **Deletion:** out of scope v1 — a card removed in Linear stays on the board
  (mark it, don't auto-delete). Deferred.

## API (`app/api/linear/route.ts` + `/sync`)

- `GET /api/linear` — connection status: enabled, team, lastCursor/last-sync.
- `POST /api/linear` — save `{ apiKey, teamId, enabled }`; resolves `stateMap` + `orgUrlKey`.
- `POST /api/linear/sync` — manual "Sync now" (runs one reconcile pass immediately).
- `GET /api/linear/teams` — list teams for the settings picker (proxied Linear call).

All pinned to the workspace (browser routes via `pinned()`).

## UI

- **`app/settings/page.tsx`** — a "Linear" panel: paste API key, pick team
  (dropdown from `GET /api/linear/teams`), enable toggle, "Sync now" button,
  last-synced timestamp.
- **Node card + detail sidebar** — when `source === "LINEAR"`: an "Open in Linear ↗"
  link (`sourceRef`) and a small Linear badge showing the identifier (e.g. `V3-339`).

## Risks / things to verify during build

- **Rate limits:** delta query (`updatedAt > cursor`) keeps request volume low;
  Linear's docs warn against naïve full polling, which we avoid. Handle 429 with
  backoff; skip a tick on error (fire-and-forget like telemetry).
- **Prune safety:** confirmed `lib/ingest.ts` only full-replaces `source=INTROSPECTION`
  tables/endpoints and never prunes roadmap nodes — `source=LINEAR` cards are safe.
  Re-verify no other reaper touches roadmap nodes by source.
- **Secret handling:** API key never leaves `~/.beacon/<id>/`; never logged; never
  sent to the deploy/telemetry endpoints.

## Phases (TDD)

1. **Connection & credentials** — `WorkspaceFlag` config read/write, `GET/POST /api/linear`, `GET /api/linear/teams`, settings panel. Test: config round-trip, teams proxy shape.
2. **Sync engine** — `lib/linear/client.ts` (GraphQL fetch), `mapping.ts` (pure maps — unit tests), `sync.ts` (reconcile LWW — table tests for the 4 branches + new-issue create + echo suppression), `daemon.ts` loop, 2-column migration (`bun run db:generate`). `POST /api/linear/sync`.
3. **Affordances** — "Open in Linear" + Linear badge on card/sidebar, "Sync now" + last-synced in settings.

## Deferred (named upgrade paths)

- **Push new Beacon cards → Linear issues** (v1 only syncs already-linked/Linear-born issues; creating issues from a Beacon plan is v2).
- **Field-level LWW** (v1 is issue-level: whole issue goes to the newer side).
- **Multi-team / project / cycle filter per workspace.**
- **Real-time via webhook** (needs public URL: tunnel or hosted relay).
- **Deletion sync.**

## Tests

- `tests/linear-mapping.test.ts` — every state/priority/label mapping, both directions.
- `tests/linear-reconcile.test.ts` — the 4 LWW branches, new-issue create, echo suppression, cursor advance.
- `tests/linear-config.test.ts` — `WorkspaceFlag` round-trip + status route shape.
