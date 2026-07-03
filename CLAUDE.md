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
- **INFRA**
  - Live refresh (SSE) — Per-workspace SSE stream that pushes a {v, nav} payload: version bumps refresh the open canvas, nav-intents navigate it; each tick also records per-workspace tab presence. (app/api/stream/route.ts, components/live-refresh.tsx, lib/nav-decide.ts, lib/nav-intent.ts, lib/tab-presence.ts)
- **INIT**
  - Repo mapping (init) — Persists a /beacon-init analysis (architecture nodes+edges, roadmap fronts, ProjectMeta incl. hasFrontend + classificationRoots) and regenerates AGENTS.md; same DB shape as propose_plan but commits directly. (app/api/architecture/sync/route.ts, app/api/init/route.ts, lib/architecture-sync.ts, lib/init.ts, lib/project-meta.ts)
- **INSTALL**
  - Global & repo install — Writes/self-heals ~/.claude (skills+hooks+CLAUDE.md) AND, when codex is detected, ~/.codex + ~/.agents plus per-repo .mcp.json + skills + AGENTS.md block; doctor audits both, uninstall reverses. (bin/doctor.ts, bin/uninstall.ts, lib/agent-config.ts, lib/assets.ts, lib/codex-install.ts, lib/global-install.ts)
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
- POST /api/changes/comment/claim
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
- POST /api/lesson/questions
- POST /api/lesson/save
- GET /api/lesson/verdict
- POST /api/map/describe
- POST /api/map/files

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
