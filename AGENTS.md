<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
- **MCP**
  - MCP server — stdio MCP server exposing beacon_map / propose_plan / context_for_feature / describe_feature / blast_radius / init_persist (incl. classificationRoots) plus @-mention resources; pins every request to its repo's workspace. (bin/mcp.ts)
- **PLAN**
  - Plan review loop — Receives proposed plans, blocks for the verdict, bundles inline annotations + /map and /db board edits into structured feedback, and archives every plan. (app/api/plan/annotations/route.ts, app/api/plan/approve/route.ts, app/api/plan/history/route.ts, app/api/plan/markdown/route.ts, app/api/plan/route.ts, lib/annotations.ts)
- **UI**
  - Notes notebook — Workspace rich-text notebook the agent can @-mention and convert into features. (components/notes/note-editor.tsx, components/notes/notes-drawer.tsx, lib/note-markdown.ts, lib/note-resource.ts, lib/notes.ts)
  - Board annotations — Persistent per-workspace annotation pins + cards on the /map canvases (BoardAnnotation table + /api/board-annotations CRUD); on /plan the same surface renders feedback-bundle annotations instead. (app/api/board-annotations/route.ts, components/graph/annotation-node.tsx, lib/annotation-anchors.ts, lib/board-annotations.ts)
  - Plan UI (/plan) — Split-screen review page: native annotation panel on the left, roadmap + database canvases tabbed on the right, plus plan history. (app/plan/page.tsx, components/plan/annotation-panel.tsx, components/plan/markdown-view.tsx, components/plan/plan-bar.tsx, components/plan/plan-history-view.tsx, components/plan/plan-workspace.tsx)
  - Roadmap canvas (/map) — React Flow roadmap/architecture canvases with node cards, detail sidebar, edge editing, and tabbed views. (app/map/page.tsx, components/graph/canvas-tabs.tsx, components/graph/deletable-edge.tsx, components/graph/detail-sidebar.tsx, components/graph/map-client.tsx, components/graph/node-card.tsx)
  - DB design canvas — React Flow tables+endpoints board with a distinct draft layer, endpoint↔table links, detail sidebar, and approve/discard draft actions. (components/graph/db-detail-sidebar.tsx, components/graph/db-draft-actions.tsx, components/graph/db-map-client.tsx, components/graph/db-table-node.tsx, components/graph/db-types.ts, components/graph/endpoint-node.tsx)
  - Settings & app shell — Layout, top nav, workspace switcher, and the settings page that drives editor choice and code-map sync. (app/layout.tsx, app/settings/page.tsx, components/top-nav.tsx, components/workspace-switcher.tsx, lib/settings.ts)

### Database
- `Feedback`: id, body, upvotes, downvotes, deleteToken, createdAt
- `Node`: id, title, parentId, x, progress, pinned, createdAt
- `NodeFile`: id, nodeId, A
- `TelemetryMachine`: id, firstSeenAt, lastSeenAt, version, platform, arch, ci, heartbeatCount

### Endpoints
- GET /api/board-annotations
- DELETE /api/board-annotations/{id}
- PATCH /api/board-annotations/{id}
- POST /api/board-layout
- GET /api/bug-flags
- DELETE /api/bug-flags/{id}
- PATCH /api/bug-flags/{id}
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
- GET /api/feedback
- POST /api/feedback
- DELETE /api/feedback/{id}
- POST /api/feedback/{id}/vote
- POST /api/map/describe
- POST /api/map/files
- POST /api/map/finish
- POST /api/map/start
- POST /api/map/touch-active
- POST /api/nodes/positions
- POST /api/nodes/subtasks
- DELETE /api/nodes/{id}
- PATCH /api/nodes/{id}
- POST /api/nodes/{id}/position
- GET /api/notes
- DELETE /api/notes/{id}

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

When the workspace HAS A FRONTEND (Beacon knows — the agent set `hasFrontend` at init, or frontend files were detected), every feature must ALSO carry `layer`: `"frontend" | "backend" | "fullstack"` — which side of the stack the work lands on. Plans omitting it are REJECTED the same way category/priority are. It works on every surface that creates roadmap cards (`beacon_propose_plan`, the ```beacon block, `beacon_start_feature`, `beacon_add_subtasks` — sub-tasks default to the parent's layer) and on architecture components (`beacon_describe_feature` / `beacon_init_persist`). In a pure-backend repo, never set it — the boards don't show it there.

REUSE before you create. Call `beacon_map` to see the features + categories that already exist. Beacon HARD-BLOCKS a feature that duplicates an existing one (it returns the existing feature to use instead) and one created without a category — so don't re-create work that's already on the board, and reuse an existing category rather than a near-synonym. `category` is the ONLY domain field. `front` (in `beacon_start_feature`) nests a feature UNDER an existing parent feature — it is NOT a domain tag; a `front` that matches no real feature is rejected.

When listing features, give each `dependsOn: ["Other feature title", …]` for any feature that must ship after another in the same plan. Beacon draws these as "depends on" links so the roadmap shows the dependency chain instead of loose, disconnected cards.

A roadmap item that is a BUG to fix (not a feature to build) should carry `kind: "BUG"` — it renders as a typed bug card. This works everywhere roadmap cards are created: `beacon_propose_plan` features, the ```beacon block, `beacon_start_feature` (when the user says they're starting on a bug), `beacon_add_subtasks` items (a bug discovered mid-work), and `beacon_init_persist` roadmap items. Default is FEATURE.

### 2b. Presenting a plan in plan mode (ExitPlanMode)

In Codex (which has no ExitPlanMode), always present plans via `beacon_present_plan` / `beacon_propose_plan` instead — this section applies to Claude Code's plan mode only.

When you present a plan via ExitPlanMode (not `beacon_propose_plan`) and it proposes DB tables/relations/endpoints or roadmap features, embed ONE fenced ```beacon code block of JSON in the plan — the same shapes `beacon_propose_plan` accepts:

```beacon
{ "tables": [...], "relations": [...], "endpoints": [...], "features": [...] }
```

Beacon extracts it deterministically and **strips the block from the prose** (it's never shown in the annotation panel), then renders the tables + features as an **editable board** on /plan so the user can edit them and have those edits flow back as feedback. Omit the block for pure code-change plans.

**The board is built ONLY from the block — prose is NOT parsed.** If your plan describes ANY database models/tables/columns in the prose (e.g. "Model `legal_precedent.py` — natural key (court, …)"), you MUST also put them in the block's `tables` array (with `columns`), or the /db tab will be empty for that plan. Same for endpoints (`endpoints` with `uses:[{table,access}]`) and features (`features`). A plan that lists five tables in prose but ships a block with only `features` renders an empty database board — exactly the "I described models but the DB tab is empty" failure. Mirror every DB entity you mention into the block.

### 3. At the end, register the work — in ONE call

Call `beacon_describe_feature` **ONCE** with a `features` array — one entry per feature the plan created — each with the files you touched and a short markdown description. This flips each one to **Done** — including its sub-tasks (the cascade completes every PENDING/IN_PROGRESS child; a sub-task you did NOT finish must be set BLOCKED or CANCELLED before registering, so it survives visibly) — and keeps `beacon_context_for_feature` accurate for the next session.

Key each entry by its node `id`: the ids are handed back to you when the plan is approved (in the approval message / additionalContext), so you don't fuzzy-match titles or pay a disambiguation round-trip. If you don't have an id, `title` still works.

Register them all in that single batched call. If a plan added five features, that's ONE `beacon_describe_feature` call with five entries — NOT five calls, and NOT just an umbrella ("Harden auth"), which leaves the individual features stuck on **Pending**.

If the feature added or materially changed a REAL architectural component (a subsystem — NOT a file), also pass `architecture: [{ title, domain, role, … }]` so the Architecture map stays accurate. It upserts curated components by title; never list files as components. If you found a bug or something worth investigating in a component's code, add `bugs: [{ note }]` to its architecture entry — it renders as a bug flag on the node (attributed to the agent); identical open flags are not duplicated. Only flag what you actually saw in the code.

Pull raw planning data anytime with `beacon_entities` (features / architecture / tables / endpoints).
<!-- beacon:workflow:end -->
