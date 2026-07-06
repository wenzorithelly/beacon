# Beacon

Beacon is the **visual planning surface for the coding agent in your terminal**.

## Focus

You (the user) are already running a Claude Code session in your terminal. That session
is the brain. Beacon is its **eyes and hands** — the place where:

- the agent proposes a feature plan visually (roadmap features + database schema)
- you review it on a canvas instead of as a wall of text
- you give it scoped, structured feedback (per-text-span annotations + overall notes)
- you approve or discard with a single click

Beacon does **not** generate plans by itself, and it does **not** start new agent sessions.
It is a helper for the session you already have open, the same way Plannotator is a helper
for an annotation flow.

## What Beacon does (and doesn't)

**Does:**

- Hosts a single `/plan` page split-screen: native annotation panel on the left, the
  roadmap + database canvases tabbed on the right.
- Hosts a `/map` page (roadmap features → sub-tasks → dependencies) and a `/db` page
  (tables + endpoints) that the agent's plan populates as drafts.
- Receives plans via the MCP tool `beacon_propose_plan` and blocks until the user
  responds.
- Sends structured feedback back to the agent on submit: inline excerpts + comments,
  optional plan-level note, deletion marks for passages the user wants gone.
- Archives every plan (approved or discarded) so the user can browse past proposals,
  their decisions, and the canvas snapshot at the time.

**Does NOT:**

- Embed a chatbot. The user already has one in their terminal.
- Generate plans on its own. Server-side AI integration exists only for incidental needs
  (e.g. computing the "what the agent sees" prompt for a node).
- Manage bugs, observability, third-party integrations, or any tracking the user can do
  in a real product. Those used to live here and were removed because they distracted
  from the focus above.

## How the loop closes

1. The user asks the agent to plan a feature in their terminal session.
2. The agent calls `beacon_propose_plan` via MCP. The tool **blocks** waiting for the
   user's verdict.
3. Beacon renders the plan on `/plan`. The user reviews, annotates, optionally writes an
   overall comment, then clicks Submit feedback OR Approve plan OR Discard.
4. The MCP tool returns the verdict to the terminal session.
5. If feedback was submitted, the agent regenerates the plan and calls
   `beacon_propose_plan` again — the loop continues.
6. On Approve, the schema + roadmap drafts are persisted; the plan is archived to
   `/plan` history.

## Stack snapshot

- Next.js App Router (this version — read `node_modules/next/dist/docs/` before relying
  on anything from memory; it does NOT match older App Router behavior).
- React 19, Tailwind 4, ShadCN, React Flow (`@xyflow/react`).
- Drizzle ORM over libSQL (a pure-JS SQLite driver that loads under BOTH the Next server and Bun;
  local-only, one file per workspace). Each per-workspace db is provisioned + migrated in-process
  via `lib/drizzle/provision.ts` — run `bun run db:generate` after a schema change.
- Bun for tests (`bun test`) — no Vite, no Jest.
- TDD on every non-trivial change.

## Behavioral notes for the agent

- All Claude-facing text (MCP tool returns, the `describeApprovedDoc` output, etc.) is
  in English so the agent reads it cleanly. UI text is also in English now.
- The word "Claude" is not used in the UI; refer to the agent as "the agent" or "your
  terminal session."
- The annotation panel auto-creates a comment when the user types after a text
  selection — do not require a button click to start commenting.
- Plannotator embedding was tried and removed; Beacon now hosts its own native
  annotation surface scoped to what the feedback loop actually needs.

<!-- beacon:start -->
## Project: beacon

Beacon is the visual planning surface for a terminal-side coding agent (Claude Code / Codex). The agent proposes a feature plan — roadmap features + database schema + endpoints — the user reviews it on a split-screen /plan canvas with inline annotations and direct board edits, and a structured verdict flows back to the terminal session. It is NOT a chatbot and does not generate plans on its own. Stack: Next.js 16 (App Router, React 19, Tailwind v4), ShadCN + base-ui, React Flow (@xyflow/react) for the maps, Drizzle ORM over libSQL (SQLite in dev, Postgres-portable), all run with Bun. Ships as a CLI (`beacon`) running one shared multi-workspace daemon, an MCP server, Claude Code/Codex hooks bridging ExitPlanMode → /plan, and a live code-intelligence daemon (intel/) that keeps the maps in sync with the real repo (import graph, tables, endpoints).

### Commands
- dev: `make dev`
- build: `make build`
- test: `make test`
- lint: `make lint`
- start: `npm run start`
- up: `make up`

### Architecture
- **CLI**
  - Beacon CLI & daemon — Registers the repo, ensures one shared background server (now on a free port when the preferred is busy), and reuses an already-open tab per workspace instead of opening a new one. (app/api/tab/nav/route.ts, app/api/tab/presence/route.ts, bin/beacon.ts, lib/daemon-port.ts, lib/daemon-server.ts)
- **CONTEXT**
  - Feature context bundle — One round-trip blast-radius bundle for a feature (attached files, 1-hop imports, domain endpoints+tables+FKs, siblings, conventions); also AGENTS.md generation and semantic search. (app/api/context/embed-backfill/route.ts, app/api/context/feature/route.ts, app/api/context/file/route.ts, lib/context-files.ts, lib/embeddings.ts, lib/feature-design.ts)
- **DATA**
  - Workspaces (multi-repo) — Per-repo registry + data dir + sqlite, the single active workspace, AsyncLocalStorage request-pin, and on-demand db provisioning/self-heal. (lib/workspaces.ts)
  - Prisma data layer — Workspace-resolving Drizzle/libSQL client (lib/db.ts) plus node/edge mutations, the roadmap read-model, and the schema + in-process provisioning/migrations. (lib/db-drizzle.ts, lib/db.ts, lib/drizzle/provision.ts, lib/drizzle/schema.ts, lib/map-ops.ts, lib/mutations.ts)
  - Draft store — The proposed-schema draft layer (DraftTable/Column/Relation) with approve→promote into the real DB tables and a verdict signal for the propose-plan loop. (app/api/draft/approve/route.ts, app/api/draft/route.ts, app/api/draft/status/route.ts, lib/draft-store.ts)
- **DBMAP**
  - Schema ingest & layout — Upserts tables/columns/relations/endpoints (empty sections never delete; curated domain/description preserved), reconciles endpoint↔table usage, prunes planned entities with no active plan, and auto-lays-out the board. (app/api/db/prune-planned/route.ts, app/api/db/reconcile-endpoints/route.ts, app/api/ingest/route.ts, lib/endpoint-layout.ts, lib/endpoint-reconcile.ts, lib/ingest.ts)
- **HOOKS**
  - Claude Code hooks bridge — PermissionRequest hook (`beacon plan`) pipes ExitPlanMode markdown → /plan (Claude Code only); PostToolUse hook (`beacon hook`) reports file edits from Claude's Edit/Write AND Codex's apply_patch; the Stop-hook nudge reads both transcript formats. (bin/hook.ts, bin/plan.ts, bin/prompt.ts, bin/stop-hook.ts, lib/hook-files.ts, lib/stop-hook-detect.ts)
  - Agent-ask bridge — Intercepts the agent's AskUserQuestion/permission prompts; routes to Beacon only when the user is FOCUSED there, mirrors questions read-only otherwise, and auto-clears via transcript watch. (app/api/ask/answered/route.ts, app/api/ask/route.ts, app/api/tab/view/route.ts, bin/ask.ts, components/ask/ask-modal.tsx, lib/ask-store.ts)
- **INFRA**
  - Live refresh (SSE) — Per-workspace SSE stream that pushes a {v, nav} payload: version bumps refresh the open canvas, nav-intents navigate it; each tick also records per-workspace tab presence. (app/api/stream/route.ts, components/live-refresh.tsx, lib/nav-decide.ts, lib/nav-intent.ts, lib/tab-presence.ts)
- **INIT**
  - Repo mapping (init) — Persists a /beacon-init analysis (architecture nodes+edges, roadmap fronts, ProjectMeta incl. hasFrontend + classificationRoots) and regenerates AGENTS.md; same DB shape as propose_plan but commits directly. (app/api/architecture/sync/route.ts, app/api/init/route.ts, lib/architecture-sync.ts, lib/init.ts, lib/project-meta.ts)
- **INSTALL**
  - Global & repo install — Writes/self-heals ~/.claude (skills+hooks+CLAUDE.md) AND, when codex is detected, ~/.codex + ~/.agents plus per-repo .mcp.json + skills + AGENTS.md block; doctor audits both, uninstall reverses. (bin/doctor.ts, bin/uninstall.ts, lib/agent-config.ts, lib/assets.ts, lib/codex-install.ts, lib/global-install.ts)
- **INTEGRATIONS**
  - Linear sync — Delta-poll reconcile loop mirroring one Linear team ↔ the roadmap board, last-writer-wins by updatedAt; personal-key auth, write-back on the same pass (lib/linear/client.ts, lib/linear/config.ts, lib/linear/daemon.ts, lib/linear/mapping.ts, lib/linear/reconcile.ts, lib/linear/sync.ts)
- **INTEL**
  - Live code-intelligence daemon — Per-workspace watchers (recently-opened subset + lazy warm-up) → registry-driven polyglot, multi-root, incremental code-graph build → pinned ingest. Degrades gracefully. (instrumentation.ts, intel/config.ts, intel/ingest.ts, intel/merge.ts, intel/pipeline.ts, intel/watch-inline.ts)
  - Code graph & files canvas — Polyglot, multi-root import-edge index (per-language resolver registry) with cached degrees + cycle flags; transitive depth-N blast-radius; hub/lang-aware files canvas with init-declared classification-root grouping. (app/api/code-graph/route.ts, components/graph/files-map-client.tsx, intel/extractors/code-graph.ts, intel/extractors/languages/index.ts, lib/code-graph.ts, lib/file-groups.ts)
- **LAUNCH**
  - Shareable boards — Serialize selected boards to a snapshot, store on the Neon deploy, render a read-only /s viewer — now with a gated, permanent, fixed-URL pinned board for contributors. (app/api/share/create/route.ts, app/api/share/route.ts, lib/share-builder.ts, lib/share-snapshot.ts, lib/share-store.ts, scripts/publish-prod-board.ts)
  - Claude Code plugin package — Ships Beacon as a Claude Code plugin INSIDE the trybeacon npm package (single repo): marketplace.json uses an npm source; build:plugin generates plugin.json + plugin/ into the package; boot bootstraps + the guard prevents double-registration. (.claude-plugin/marketplace.json, bin/boot.ts, scripts/build-plugin.ts)
- **LEARN**
  - Lessons learning surface — Agent-authored interactive code explanations: a concept map + plain-English narrative on /learn the user questions back in a blocking loop (beacon_explain), saved to a library. (app/learn/page.tsx, bin/mcp.ts, components/graph/lesson-map-client.tsx, components/learn/learn-workspace.tsx, components/learn/lesson-library-view.tsx, components/learn/lesson-narrative-panel.tsx)
- **MCP**
  - MCP server — stdio MCP server; feature lifecycle now via one beacon_feature({action}) tool (add/start/subtasks/done); beacon_map carries categories; beacon_entities is paginated/truncated (bin/mcp.ts)
- **PLAN**
  - Plan review loop — Receives proposed plans, blocks for the verdict, bundles inline annotations + /map and /db board edits into structured feedback, and archives every plan. (app/api/plan/annotations/route.ts, app/api/plan/approve/route.ts, app/api/plan/history/route.ts, app/api/plan/markdown/route.ts, app/api/plan/route.ts, lib/annotations.ts)
  - Plan scope guard — Per-plan scope contracts: declare→freeze→pre-edit gate (ask)→authorize-grows-contract, behind a generalized WorkspaceFlag (app/api/flags/route.ts, app/api/scope-guard/check/route.ts, bin/guard.ts, components/scope-guard-card.tsx, lib/feature-flags.ts, lib/scope-contract.ts)
  - Changes review surface — Overview-first live review of the agent's working-tree changes with lenses, viewed-tracking, line-comments back to the agent, and deterministic quality signals (app/api/changes/quality/route.ts, app/api/changes/route.ts, components/changes/changes-client.tsx, components/changes/diff-detail.tsx, components/changes/file-card.tsx, components/changes/overview.tsx)
- **UI**
  - Notes notebook — Workspace rich-text notebook the agent can @-mention and convert into features. (components/notes/note-editor.tsx, components/notes/notes-drawer.tsx, lib/note-markdown.ts, lib/note-resource.ts, lib/notes.ts)
  - Board annotations — Persistent per-workspace annotation pins + cards on the /map canvases (BoardAnnotation table + /api/board-annotations CRUD); on /plan the same surface renders feedback-bundle annotations instead. (app/api/board-annotations/route.ts, components/graph/annotation-node.tsx, lib/annotation-anchors.ts, lib/board-annotations.ts)
  - Plan UI (/plan) — Split-screen review page: native annotation panel on the left, roadmap + database canvases tabbed on the right, plus plan history. (app/plan/page.tsx, components/plan/annotation-panel.tsx, components/plan/markdown-view.tsx, components/plan/plan-bar.tsx, components/plan/plan-history-view.tsx, components/plan/plan-workspace.tsx)
  - Roadmap canvas (/map) — React Flow roadmap/architecture canvases with node cards, detail sidebar, edge editing, and tabbed views. (app/map/page.tsx, components/graph/canvas-tabs.tsx, components/graph/deletable-edge.tsx, components/graph/detail-sidebar.tsx, components/graph/map-client.tsx, components/graph/node-card.tsx)
  - DB design canvas — React Flow tables+endpoints board with a distinct draft layer, endpoint↔table links, detail sidebar, and approve/discard draft actions. (components/graph/db-detail-sidebar.tsx, components/graph/db-draft-actions.tsx, components/graph/db-map-client.tsx, components/graph/db-table-node.tsx, components/graph/db-types.ts, components/graph/endpoint-node.tsx)
  - Settings & app shell — Layout, top nav, workspace switcher, and the settings page that drives editor choice and code-map sync. (app/layout.tsx, app/settings/page.tsx, components/top-nav.tsx, components/workspace-switcher.tsx, lib/settings.ts)

### Database
- `AppSetting`: id, editor, currentFeatureId, updatedAt
- `BoardAnnotation`: id, targetKind, targetId, columnName, body, x, y, createdAt, updatedAt
- `BugFlag`: id, nodeId, by, note, resolvedAt, createdAt
- `CodeFile`: path, root, lang, x, y, mtimeMs, size, inDegree, outDegree, updatedAt
- `CodeFileEdge`: fromPath, toPath, circular
- `DbColumn`: id, tableId, name, type, isPk, isFk, nullable, note, ord
- `DbRelation`: id, fromTableId, toTableId, fromColumn, toColumn, label
- `DbTable`: id, name, domain, description, source, planId, x, y, createdAt, updatedAt
- `DraftColumn`: id, tableId, name, type, isPk, isFk, nullable, note, ord
- `DraftRelation`: id, fromTableId, toTableId, fromColumn, toColumn, label
- `DraftTable`: id, name, domain, description, x, y, createdAt
- `Edge`: id, fromId, toId, kind, label, sourceHandle, targetHandle
- `Endpoint`: id, method, path, domain, description, source, planId, x, y, createdAt, updatedAt
- `EndpointTable`: id, endpointId, tableId, access
- `Node`: id, view, kind, cluster, layer, title, role, plain, status, priority, progress, x
- `NodeFile`: id, nodeId, path
- `Note`: id, title, body, ord, pinned, createdAt, updatedAt
- `PlanContract`: id, planId, declaredFiles, authorizedExtras, active, createdAt, updatedAt
- `ProjectMeta`: id, overview, conventions, hasFrontend, classificationRoots, updatedAt
- `SharedBoard`: token, payload, selectedTabs, workspaceLabel, version, createdAt, expiresAt
- `SyncState`: id, version, codeGraphSyncedAt, updatedAt
- `Tag`: id, label, color
- `TelemetryMachine`: id, firstSeenAt, lastSeenAt, version, platform, arch, ci, heartbeatCount
- `WorkspaceFlag`: id, key, enabled, config, updatedAt
- `_NodeTags`: A, B

### Endpoints
- GET /api/ask
- GET /api/board-annotations
- DELETE /api/board-annotations/{id}
- PATCH /api/board-annotations/{id}
- POST /api/board-layout
- GET /api/bug-flags
- DELETE /api/bug-flags/{id}
- PATCH /api/bug-flags/{id}
- DELETE /api/changes/comment
- GET /api/changes/comment
- POST /api/changes/comment
- PATCH /api/changes/comment
- POST /api/changes/comment/answer
- POST /api/changes/comment/claim
- POST /api/changes/quality
- POST /api/changes/viewed
- POST /api/code-graph/position
- POST /api/context
- GET /api/context/feature
- GET /api/context/file
- POST /api/db/arrange
- POST /api/db/backfill-access
- POST /api/db/position
- POST /api/db/prune-planned
- POST /api/db/reconcile-endpoints
- DELETE /api/db/relations/{id}
- DELETE /api/db/tables/{id}
- DELETE /api/draft
- GET /api/draft/status
- POST /api/edges
- DELETE /api/edges/{id}
- DELETE /api/endpoints/{id}
- GET /api/entities
- GET /api/lesson
- POST /api/lesson
- POST /api/lesson/close
- GET /api/lesson/presence
- POST /api/lesson/presence
- DELETE /api/lesson/questions
- GET /api/lesson/questions

### Conventions & gotchas
- This is Next.js 16 App Router with breaking changes — read node_modules/next/dist/docs/ before relying on memory; APIs and conventions differ from older App Router.
- Bun for everything: package management, runtime, and tests (`bun test` / `make test`) — never npm/yarn, no Jest, no Vite.
- Drizzle ORM over libSQL is the data layer (pure-JS driver loads under BOTH the Next server AND Bun). After editing lib/drizzle/schema.ts run `bun run db:generate`; the runtime applies pending migrations to EVERY per-workspace SQLite db in-process via lib/drizzle/provision.
- Never construct the Drizzle/libSQL client directly — import `db` from lib/db.ts; it resolves the active or request-pinned workspace. Browser routes wrap handlers in pinned(); agent/watcher routes pin via runWithWorkspace(resolveRequestWorkspaceId(req), …).
- Keep the schema Postgres-portable: no enum columns (use text + Zod unions) and no scalar-array columns (model arrays as related rows, or JSON-encode in a text column like conventions/classificationRoots).
- All agent-facing text (MCP returns, context bundles, AGENTS.md) is in English; the UI never says 'Claude' — refer to it as 'the agent' or 'your terminal session'.
- The AGENTS.md project block lives between the beacon:start/beacon:end markers and is regenerated by lib/context-files.ts — edit outside the markers; CLAUDE.md @imports AGENTS.md.
- TDD on non-trivial changes; tests live in tests/ and run via `bun test`. Multi-workspace data lives under ~/.beacon/<id>/ (overridable with BEACON_HOME), not in the repo.
- Publish ONLY via the release.yml workflow (`gh workflow run release.yml -f bump=patch`) — it bumps, tests, npm-publishes, tags, and cuts the GitHub release the update banner needs. build:release strips .next/dev + source maps so the tarball stays ~12MB.

_Maintained by Beacon — edit outside the markers; this block is regenerated._
<!-- beacon:end -->

<!-- beacon:workflow:start -->
## Beacon — feature workflow

This project uses Beacon (a local planning/visualization panel; run `beacon` to open it). When you start work on a FEATURE — whether referenced via an `@beacon:feature://…` mention, an `@beacon:note://…` note the user wrote in the Notes panel (treat its checkbox `- [ ]` todos as subtasks and order features by their dependencies), or just described in chat — follow these steps in order:

### 1. Load context FIRST — do NOT Glob/Grep the codebase blind

Call `beacon_context_for_feature({ id | title | query })` BEFORE reading files. It returns, in one round-trip:
- the files the feature is attached to,
- what those files import + what imports them (live code-graph blast radius),
- endpoints in the feature's domain + the tables each touches + those tables' FK relations,
- sibling architecture components and the project's conventions.

That bundle replaces the discovery phase. Read only the files it returns plus whatever those imports lead you to. If the feature has no files attached yet, the bundle still gives you the domain map — Glob is a last resort.

Mid-feature, when deciding whether a change is safe, call `beacon_blast_radius({ path })` for the file you're about to edit — same code-graph data, file-centric.

### 2. Design the data BEFORE writing code

Determine the database tables the feature needs. If any don't exist yet, design the schema and call `beacon_propose_plan` (tables + relations + endpoints). This renders an **editable draft on the /plan page** for the user to review. The tool BLOCKS until the user clicks Approve / Discard / submits feedback. Implement migrations + code ONLY after it returns approval.

When listing endpoints, give each `uses: [{ table, access }]` so the endpoint→table links draw on /db.

EVERY feature MUST carry `category` (e.g. AUTH | SEARCH | DATA | INTEL | BILLING | …; `cluster` is accepted as an alias) and `priority` (0 = P0 critical, 1 = P1 high, 2 = P2 medium, 3 = P3 low). Beacon REJECTS a plan whose features omit either — `beacon_propose_plan` returns the list of what's missing, and an ExitPlanMode ```beacon block is denied — so set both on every feature instead of relying on defaults.

When the workspace HAS A FRONTEND (Beacon knows — the agent set `hasFrontend` at init, or frontend files were detected), every feature must ALSO carry `layer`: `"frontend" | "backend" | "fullstack"` — which side of the stack the work lands on. Plans omitting it are REJECTED the same way category/priority are. It works on every surface that creates roadmap cards (`beacon_propose_plan`, the ```beacon block, `beacon_feature` — sub-tasks default to the parent's layer) and on architecture components (`beacon_feature` action:done / `beacon_init_persist`). In a pure-backend repo, never set it — the boards don't show it there.

### Adding a card directly — `beacon_feature` (no review gate)

To put a card on the board WITHOUT the plan-review flow, call `beacon_feature` — ONE tool for a feature's whole lifecycle:
- `{ action: "add" }` creates a card in a SINGLE call. It defaults to `status: "backlog"` (a PENDING item you're NOT working on yet); pass `status: "active"` to start it IN_PROGRESS now. A title that matches an existing card in the SAME category + layer returns `exists` (reuse it) — the same title in a DIFFERENT category or layer (FE/BE/FS) creates a distinct card; `add` never activates or demotes a card already on the board.
- `{ action: "start" }` marks an existing card IN_PROGRESS (create-or-flag).
- `{ action: "subtasks" }` adds child tasks under a card.
- `{ action: "done" }` completes feature(s) and registers the files/architecture touched.

A NEW card REQUIRES `category` + `priority` (and `layer` where the workspace has a frontend). Use `beacon_propose_plan` / `beacon_present_plan` only when you want the user to REVIEW before the card lands.

REUSE before you create. Call `beacon_map` FIRST — it lists every card with its `category`, `priority`, `layer` and `status`, so you reuse an existing category (don't invent a near-synonym) and spot duplicates WITHOUT calling `beacon_entities`. Beacon blocks only an EXACT duplicate — same title AND category AND layer — plus a card created without a category; a same-named card in a DIFFERENT category, or on a different layer (frontend/backend/fullstack), is allowed as its own card. `category` is the ONLY domain field. `front` (in `beacon_feature`) nests a card UNDER an existing parent feature — it is NOT a domain tag; a `front` that matches no real feature is rejected.

When listing features, give each `dependsOn: ["Other feature title", …]` for any feature that must ship after another in the same plan. Beacon draws these as "depends on" links so the roadmap shows the dependency chain instead of loose, disconnected cards.

A roadmap item that is a BUG to fix (not a feature to build) should carry `kind: "BUG"` — it renders as a typed bug card. This works everywhere roadmap cards are created: `beacon_propose_plan` features, the ```beacon block, `beacon_feature` (add/start when the user is working on a bug; or `subtasks` items for a bug discovered mid-work), and `beacon_init_persist` roadmap items. Default is FEATURE.

### 2b. Presenting a plan in plan mode (ExitPlanMode)

In Codex (which has no ExitPlanMode), always present plans via `beacon_present_plan` / `beacon_propose_plan` instead — this section applies to Claude Code's plan mode only.

When you present a plan via ExitPlanMode (not `beacon_propose_plan`) and it proposes DB tables/relations/endpoints or roadmap features, embed ONE fenced ```beacon code block of JSON in the plan — the same shapes `beacon_propose_plan` accepts:

```beacon
{ "tables": [...], "relations": [...], "endpoints": [...], "features": [...] }
```

Beacon extracts it deterministically and **strips the block from the prose** (it's never shown in the annotation panel), then renders the tables + features as an **editable board** on /plan so the user can edit them and have those edits flow back as feedback. Omit the block for pure code-change plans.

**The board is built ONLY from the block — prose is NOT parsed.** If your plan describes ANY database models/tables/columns in the prose (e.g. "Model `legal_precedent.py` — natural key (court, …)"), you MUST also put them in the block's `tables` array (with `columns`), or the /db tab will be empty for that plan. Same for endpoints (`endpoints` with `uses:[{table,access}]`) and features (`features`). A plan that lists five tables in prose but ships a block with only `features` renders an empty database board — exactly the "I described models but the DB tab is empty" failure. Mirror every DB entity you mention into the block.

### 2c. Mark the files you mention — write repo-relative paths in backticks

When a plan, feature, or architecture-component description mentions a source file, write its **repo-relative path inside backticks** — `app/api/plan/route.ts`, not "the plan route". On the /plan canvas Beacon turns every backticked token that matches a REAL repo file into a clickable mention that opens it in the user's editor; a bare filename matching several files (e.g. `route.ts`) opens a pick-one dropdown of the same-named candidates. The match is deterministic against the live code graph, so a path that isn't a real file just stays plain text — there's no special syntax to learn and no downside to over-marking: always name files by their real path so the reader can jump straight to the code.

### 3. At the end, register the work — in ONE call

Call `beacon_feature({ action: "done" })` **ONCE** with a `features` array — one entry per feature the plan created — each with the files you touched and a short markdown description. This flips each one to **Done** — including its sub-tasks (the cascade completes every PENDING/IN_PROGRESS child; a sub-task you did NOT finish must be set BLOCKED or CANCELLED before registering, so it survives visibly) — and keeps `beacon_context_for_feature` accurate for the next session.

Key each entry by its node `id`: the ids are handed back to you when the plan is approved (in the approval message / additionalContext), so you don't fuzzy-match titles or pay a disambiguation round-trip. If you don't have an id, `title` still works.

Register them all in that single batched call. If a plan added five features, that's ONE `beacon_feature({ action: "done" })` call with five entries — NOT five calls, and NOT just an umbrella ("Harden auth"), which leaves the individual features stuck on **Pending**.

If the feature added or materially changed a REAL architectural component (a subsystem — NOT a file), also pass `architecture: [{ title, domain, role, … }]` so the Architecture map stays accurate. It upserts curated components by title; never list files as components. If you found a bug or something worth investigating in a component's code, add `bugs: [{ note }]` to its architecture entry — it renders as a bug flag on the node (attributed to the agent); identical open flags are not duplicated. Only flag what you actually saw in the code.

Pull raw planning data anytime with `beacon_entities` (features / architecture / tables / endpoints).
<!-- beacon:workflow:end -->
