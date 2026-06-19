# Beacon

Beacon is the **visual planning surface for the coding agent in your terminal**.

You already have a Claude Code session running — that session is the brain. Beacon is its
**eyes and hands**: the place where the agent proposes a feature plan (roadmap features +
database schema + endpoints), you review it on a canvas instead of as a wall of text, give
scoped structured feedback, and approve or discard with a click. Beacon does **not** embed
a chatbot and does **not** generate plans on its own.

> **See it live** — explore Beacon's own architecture & database on a read-only board,
> generated from this very repo (no install): **[trybeacon.sh/s/beacon](https://www.trybeacon.sh/s/beacon)**

## How the loop closes

1. You ask the agent to plan a feature in your terminal session.
2. The agent calls the MCP tool `beacon_propose_plan`. The tool **blocks** waiting for your
   verdict.
3. Beacon renders the plan on `/plan` — a split screen with a native annotation panel on the
   left and the roadmap + database canvases tabbed on the right.
4. You review, annotate inline, optionally edit the `/map` and `/db` boards directly, then
   click **Submit feedback**, **Approve plan**, or **Discard**.
5. The verdict (plus any feedback) returns to the terminal session. On approve, the schema +
   roadmap drafts are persisted and the plan is archived to `/plan` history.

## Views

- **/plan** — the review surface: annotation panel + roadmap/database canvases + plan history.
- **/map** — the roadmap (features → sub-tasks → dependencies) and the architecture inventory,
  as interactive React Flow graphs. A **files** tab renders the live import graph.
- **/db** — the database design: tables (columns, PK/FK markers), FK relationships, and which
  endpoints touch which tables — with a distinct **draft** layer for proposed schema.
- **/settings** — editor choice, code-map sync, and the danger zone.

## Stack

- Next.js 16 (App Router, React 19, Turbopack) · TypeScript · Tailwind v4
- ShadCN + **base-ui** primitives; React Flow (`@xyflow/react`) for the maps
- **Drizzle ORM** over **`bun:sqlite`** (Bun's built-in SQLite — no native addon, no driver
  adapter). The DB is local-only, one file per workspace under `~/.beacon/<id>/`.
- **Bun** for package management, runtime, and tests (`bun test` — native, no Vite)

## Install & run

Beacon ships as a CLI. Install it globally:

```bash
npm install -g trybeacon      # or: bun add -g trybeacon
```

Then run it inside any repo:

```bash
beacon            # registers the repo, ensures the shared server, opens the panel
beacon doctor     # audit what's wired (global hooks, repo .mcp.json, AGENTS.md block)
beacon stop       # stop the shared background server
```

> Prefer Claude Code's plugin system? Add the marketplace and install the plugin instead:
> `/plugin marketplace add wenzorithelly/beacon-plugin` then `/plugin install beacon@trybeacon`.

One shared Beacon server (daemon) serves every repo you open; each repo keeps its own data in
`~/.beacon/<id>/` (override the root with `BEACON_HOME`). On first run in a repo, run
`/beacon-init` in your Claude Code session to map the project's architecture, schema, and
roadmap into Beacon.

### Local development of Beacon itself

```bash
make install     # bun install
make dev         # next dev + the intel watcher together
make test        # bun test (data layer, mutations, ingest, plan loop, code graph, intel…)
make studio      # drizzle studio
```

> Schema note: edit `lib/drizzle/schema.ts`, then `bun run db:generate` (drizzle-kit) to add a
> migration and restart the dev server. Existing local DBs self-heal on open (lib/drizzle/provision).

## Live code-intelligence daemon (`intel/`)

As you write code (any language), a watcher keeps the `/db` and **files** maps in sync —
tables, FK relationships, endpoint↔table usage, and the import graph — updating live as you
save. It reads an optional `beacon.config.json` at the repo root (`roots[]`, `openapiUrl?`,
`controlUrl?`), or derives everything from the repo when run via the CLI.

```bash
make up      # terminal 1: the panel server
make watch   # terminal 2: the watcher  (or `make dev` to run both)
```

On each save: debounced watcher → gather source files + the framework's OpenAPI spec + the
import graph → **deterministic parsers** emit a structured graph (tables/columns/FKs +
endpoint↔table usage) → `POST /api/ingest` upserts it (preserving your manual nodes + hand-
placed positions) → SSE refreshes the open map. Introspected nodes show a green "live" dot.

**No AI, no API key.** The live daemon is **fully deterministic** — language-aware parsers
build the import graph and detect tables, columns, FKs, and endpoints (from OpenAPI + framework
conventions). Nothing in the watcher calls a model.

The *semantic* layer — architecture component names, plain-language descriptions, and the
roadmap — comes from **your Claude Code session**, not a background process. Run `/beacon-init`
once to map the repo and `/beacon-refresh` to keep it current: the agent reads the code and
calls Beacon's MCP tools directly. There's no Claude CLI and no Anthropic API in the loop.

## Deploy

Beacon is local-first: every user's boards live in per-workspace SQLite on their own machine,
so there is **no production database**. A hosted deployment is just the static app + (optionally)
read-only shared-board snapshots persisted to a blob/KV store — no Postgres, no migrations to run
against a server.

(The one exception is the deploy's small shared Neon Postgres holding the anonymous feedback
board and the telemetry counters below — never user board data.)

## Telemetry

Beacon sends an **anonymous heartbeat** at most every 12 hours while the local server runs, so we
can count active installs (npm download counts are dominated by mirrors and CI). The payload is
exactly five fields: a random machine id (a locally generated UUID tied to nothing), the Beacon
version, OS, CPU architecture, and a CI flag. **Never** repo names, file paths, code, plans, or
board content; IP addresses are not stored. Inspect the exact payload with `beacon telemetry status`.

Opt out any time with `beacon telemetry off`, `BEACON_TELEMETRY_DISABLED=1`, or `DO_NOT_TRACK=1`.

## Contributing

Contributions are welcome! New here? Explore Beacon's own
**[architecture & database board](https://www.trybeacon.sh/s/beacon)**
(read-only, generated from this codebase) before you start.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup and the workflow.
All contributors sign a one-click [CLA](./CLA.md), and the project follows a
[Code of Conduct](./CODE_OF_CONDUCT.md). For dependency/licensing rules see
[OSS-POLICY.md](./OSS-POLICY.md); to report a vulnerability see [SECURITY.md](./SECURITY.md).

## License

Beacon is licensed under the [Apache License 2.0](./LICENSE).
