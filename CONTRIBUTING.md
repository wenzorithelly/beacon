# Contributing to Beacon

Thanks for your interest in Beacon — the visual planning surface for the coding agent in
your terminal. This guide covers how to get set up, the contribution flow, and the one legal
step every contributor must complete (the CLA).

## Start here: the live map of Beacon

Before writing any code, explore Beacon's own architecture and database schema on a read-only
board — the same canvases Beacon renders for any repo, generated from this codebase:

**👉 https://www.trybeacon.sh/s/beacon**

- **Architecture** — the subsystems (CLI, MCP server, plan loop, code-intelligence daemon, …)
  and how they depend on each other.
- **Database** — every table, its columns (PK/FK markers), and the endpoints that touch them.

It's a snapshot of `main`, so it may trail slightly; the source is always the ground truth.

## Contributor License Agreement (required)

Before your first pull request can be merged, you must sign Beacon's
[Contributor License Agreement](./CLA.md). When you open a PR, an automated check
(CLA Assistant) will post a one-time link — signing is a single click and applies to all your
future contributions.

**Why:** the CLA lets you keep the copyright to your contribution while granting the project a
broad license to use, sublicense, and (if needed) relicense it. Without it the project could not
ship under a single coherent license, dual-license a future commercial edition, or be sold or
transferred cleanly. See the [CLA](./CLA.md) for the exact terms.

## Project layout

Beacon is a Next.js 16 (App Router, React 19) app run entirely with **Bun**, shipping as a CLI
(`beacon`) plus an MCP server and a live code-intelligence daemon. The high-level map lives in
[`AGENTS.md`](./AGENTS.md) — read it before making structural changes.

- `app/` — Next.js routes + API endpoints
- `components/` — React UI (React Flow canvases, ShadCN/base-ui)
- `lib/` — data layer (Drizzle/libSQL), mutations, plan loop, context bundles
- `intel/` — the live code-intelligence daemon (import graph, tables, endpoints)
- `bin/` — the CLI, MCP server, and agent hooks
- `tests/` — `bun test` suites

## Development setup

You need **[Bun](https://bun.sh)** on your PATH.

```bash
make install     # bun install
make dev         # next dev + the intel watcher together
make test        # bun test
make lint        # eslint
make studio      # drizzle studio
```

> **Schema changes:** edit `lib/drizzle/schema.ts`, then run `bun run db:generate` (drizzle-kit) to
> add a migration. Existing local DBs self-heal on open. Keep the schema **Postgres-portable** — no
> enum columns (use text + Zod unions) and no scalar-array columns (model arrays as related rows or
> JSON-encode in a text column).

## Contribution flow

1. **Open an issue first** for anything non-trivial, so we can align on the approach before you
   build.
2. Fork and branch from `main`.
3. **Write tests.** Beacon is test-driven — non-trivial changes need a `bun test` suite that fails
   before your change and passes after.
4. Keep commits small and focused; use **Conventional Commit** messages
   (`feat(scope): …`, `fix(scope): …`, `chore(scope): …`).
5. Run `make test` and `make lint` locally — CI runs both plus a secret scan on every PR.
6. Open a PR against `main`, fill in the template, and make sure the CLA check is green.

## Reporting security issues

Do **not** open a public issue for security vulnerabilities. Follow [`SECURITY.md`](./SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating you agree
to uphold it.
