# Juriscan Control

A personal admin tool — an interactive **completion mental-map** for managing the
from-scratch rebuild of Juriscan (a Brazilian legal-precedent search SaaS). It
answers, at a glance: *what is the state of the app, what is going to be built, and
where are the current bugs.*

## Views

- **/map** — the production-reform roadmap (emergency + 4 fronts + Definition of Done)
  and a planned-architecture inventory, as two interactive React Flow graphs. Drag,
  add/edit nodes and subnodes, change status, cancel, deprioritize, delete; per-node
  bug badges; status + "só com bugs" filters. Positions persist.
- **/db** — the proposed **Juriscan v2 database design** (FastAPI + SQLAlchemy +
  Alembic): tables with columns (PK/FK markers, types), FK relationships, and which
  API endpoints touch which tables (toggleable). Click a table to see its columns,
  FKs in/out, and the endpoints that use it.
- **/list** — roadmap + architecture as cards (shareable, accessible fallback).
- **/bugs** — the confirmed issues table with severity, linked front, and `file:line`.

## Stack

- Next.js 16 (App Router, React 19, Turbopack) · TypeScript · Tailwind v4
- **Watermelon UI** (shadcn-compatible registry) for static components; **base-ui**
  shadcn components for the overlay primitives (Dialog/AlertDialog/Select) — the
  Watermelon overlays rely on a `render` prop the latest `radix-ui` (1.4.3) ignores.
- React Flow (`@xyflow/react`) for the maps
- **Prisma 7** + **libSQL** driver adapter over SQLite (better-sqlite3's native addon
  doesn't load under Bun — libSQL does). Bun for package management + runtime.
- Vitest for tests

## Develop

```bash
make install     # bun install
make db-up        # apply migrations (creates dev.db)
make seed         # seed roadmap, architecture, bugs, and the v2 DB design
make up           # next dev → http://localhost:3000
make test         # vitest (32 tests: data layer, seed integrity, mutations, db design)
make studio       # prisma studio
```

> Prisma 7 note: after changing the schema, run `bunx prisma generate` and restart
> the dev server (the client singleton is cached in-process).

## Deploy (Vercel + Neon Postgres)

The schema is Postgres-portable (no enums, no scalar lists). To deploy:

1. Provision **Neon Postgres** (Vercel Marketplace → Storage). Set `DATABASE_URL`
   (pooled) and `DIRECT_URL` (unpooled, for migrations) in Vercel project env.
2. In `prisma/schema.prisma`, set `datasource.provider = "postgresql"`.
3. In `lib/db.ts`, swap the adapter to Postgres:
   `bun add @prisma/adapter-pg pg` and use `new PrismaPg({ connectionString: process.env.DATABASE_URL })`
   (or `@prisma/adapter-neon` for the serverless driver).
4. Generate fresh Postgres migrations against Neon: `bunx prisma migrate deploy`.
5. Seed once: `make seed` (or a protected route) against the Neon URL.
6. `bunx vercel --prod` (build runs `prisma generate && next build`).

The build already runs `prisma generate` (see `package.json` → `build`).

## Deferred hooks (data model is ready)

- **Codebase introspection** → upsert `Node`s with `source='INTROSPECTION'`, real
  `sourceRef`/`externalId`. Both map views already render `sourceRef`.
- **Sentry** → a future adapter upserts `Bug`s on `@@index([source, externalId])`
  with `source='SENTRY'`. The bugs view already renders them.
- **SQLAlchemy/FastAPI introspection** → upsert `DbTable`/`DbColumn`/`DbRelation`/
  `Endpoint`/`EndpointTable` from the real backend once it exists.
