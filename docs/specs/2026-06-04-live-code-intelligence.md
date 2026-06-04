# Juriscan Intel — live code-intelligence daemon (spec)

**Goal:** As you code Juriscan v2 (any language), a watcher keeps the control app's
DB-design + maps in sync, live. Graceful hybrid: AI (Claude) carries early/semantics;
deterministic extractors (Atlas schema, OpenAPI endpoints) take over facts when the
dev DB / server exist. Manual nodes (roadmap, bugs, hand-placed positions) are preserved.

## Components (all in `admin/intel/`, TypeScript/Bun)

1. **Config** `juriscan.config.json` (repo root): `roots[]`, `databaseUrl?`, `openapiUrl?`,
   `ignore[]`, `llm{model}`, `controlUrl` (default http://localhost:3000). All optional → degrades.
2. **Watcher** (`watch.ts`): chokidar, recursive, ignores admin/node_modules/.git/build,
   debounced (~400ms, coalesced). On change → run pipeline → POST snapshot.
3. **Fact extractors** (`extractors/`):
   - `openapi.ts` — fetch `openapiUrl` → endpoints (method/path/tags). Pure parser tested with fixture.
   - `atlas.ts` — shell out `atlas schema inspect --url <db> --format '{{json .}}'` → tables/columns/FKs.
     Optional: skip if atlas missing or no databaseUrl. Parser tested with fixture JSON.
   - `files.ts` — scan roots → file/module list (feeds the AI; structure).
   - (tree-sitter deferred behind a `StructureExtractor` interface — AI covers structure for v1.)
4. **AI layer** (`ai.ts`): Anthropic SDK. Input = changed-file contents (diffs) + current graph +
   deterministic facts. Output = strict JSON via tool-use (StructuredOutput): tables/columns/relations,
   endpoint↔table usages, optional architecture nodes, plain-English. Prompt caching on the stable
   context. **Graceful no-key fallback**: if `ANTHROPIC_API_KEY` unset → deterministic-only (facts), warn.
5. **Merger** (`merge.ts`): reconcile facts + AI deltas into a canonical snapshot keyed by stable IDs
   (table name; `METHOD path`; file path).
6. **Ingest client** (`ingest.ts`): POST snapshot → control app.

## Control app additions

- Schema: add `source String @default("MANUAL")` to `DbTable` + `Endpoint` (Node/Bug already have it).
- `POST /api/ingest` — Zod-validated snapshot. Full-replace of `source=INTROSPECTION` entities within
  scope: upsert by stable key (preserve existing x/y), delete introspected entities absent from the
  snapshot. Manual entities untouched. Bumps a `SyncState.version` row.
- Live refresh — `GET /api/stream` (SSE) emits on version bump; `/db` + `/map` subscribe and
  `router.refresh()`. Poll fallback on `GET /api/version`. Transport abstracted.
- Rendering — introspected nodes show a small "live" dot.

## Data flow

`save → watcher(debounce) → [openapi + atlas + files facts] + [Claude semantics on diffs] → merge →
snapshot.json → POST /api/ingest → upsert + version bump → SSE → /db & /map refresh`.

## Error handling

Atlas/DB/OpenAPI unavailable → skip those facts, AI carries, warn (never crash). No API key →
deterministic-only. LLM error/rate-limit → backoff, keep last-good, show "stale". Malformed AI output →
schema-validate + retry, never write partial. Ingest idempotent.

## Testing

- `/api/ingest` upsert/replace/position-preserve/drift against the test DB.
- `openapi.ts` + `atlas.ts` parsers against fixtures.
- AI merge with a **mocked Claude response** (no live API) → schema validation + merge.
- E2E: fixture backend (few files + fake openapi.json) → pipeline (mock AI) → asserted snapshot ingested.

## Run

`make up` (control app) · `make watch` (daemon) · `make dev` (both). Needs `ANTHROPIC_API_KEY` for the
AI layer; works deterministically without it. `atlas` binary optional.
