.PHONY: install up down build test test-watch lint db-up db-reset studio db-postgres deploy watch dev publish

install:    ## install deps
	bun install

up:         ## run the control app dev server (http://localhost:3000)
	bun run dev

# BEACON_REPO pins the watcher's posts to THIS repo's workspace — without it a header-less
# /api/ingest falls back to whatever workspace the browser has active and writes there.
watch:      ## run the live code-intelligence watcher (control app must be up)
	BEACON_REPO="$(CURDIR)" bun run intel/watch.ts

dev:        ## drop into hot-reload to edit: stops the prod `beacon` daemon, serves :4319 (run `beacon` to return to prod)
	@beacon stop 2>/dev/null || true
	@PORT=4319 bash -c 'bun run dev & DEV=$$!; trap "kill $$DEV 2>/dev/null" EXIT; sleep 2; BEACON_REPO="$(CURDIR)" bun run intel/watch.ts'

down:       ## no daemon — stop the dev server with Ctrl-C
	@echo "No background daemon. Stop the dev server with Ctrl-C."

build:      ## production build
	bun run build

test:       ## run the test suite once (bun test — native, no Vite)
	bun test

test-watch: ## run tests in watch mode
	bun test --watch

lint:       ## lint
	bun run lint

db-up:      ## generate a migration from lib/drizzle/schema.ts (runtime applies it per workspace)
	bun run db:generate

db-reset:   ## drop + re-provision the local dev db (local only)
	rm -f dev.db dev.db-wal dev.db-shm && bun lib/drizzle/provision.ts file:./dev.db

studio:     ## open Drizzle Studio
	bun run db:studio

db-postgres: ## deploy-time: move the Drizzle dialect to postgres for a hosted db
	@echo "1) set dialect: 'postgresql' in drizzle.config.ts and point lib/db.ts at a pg driver"
	@echo "2) set DATABASE_URL to the hosted (e.g. Neon) URL"
	@echo "3) regenerate + apply migrations: bun run db:generate && bunx drizzle-kit migrate"

deploy:     ## deploy to Vercel (prod)
	bunx vercel --prod

publish:    ## ship edits to the prod default: bump + rebuild + publish to npm, then refresh your global `beacon`
	@# Bump the version (npm won't republish the same one). No git tag/commit — you control commits.
	npm version $(BUMP) --no-git-tag-version
	@# `npm publish` runs prepublishOnly (next build + bun build of the CLI). Needs a 2FA-bypass npm token in ~/.npmrc.
	@# Stop `make dev` first — the build writes .next.
	npm publish --access public
	@# Refresh the global `beacon` to the just-published version. bun caches registry metadata and
	@# the registry CDN lags a few seconds, so clear the cache and retry until it resolves.
	@V=$$(node -p "require('./package.json').version"); \
	  echo "  ✓ published trybeacon@$$V — refreshing your global beacon…"; \
	  for i in 1 2 3 4 5 6; do \
	    bun pm cache rm >/dev/null 2>&1; \
	    bun add -g trybeacon@$$V >/dev/null 2>&1 && { echo "  ✓ your beacon now runs trybeacon@$$V"; break; }; \
	    if [ $$i = 6 ]; then echo "  ⚠ publish OK but the global refresh kept lagging — run later: bun pm cache rm && bun add -g trybeacon@$$V"; \
	    else echo "  …waiting for npm to propagate ($$i/6)"; sleep 5; fi; \
	  done

# Override the bump for `make publish` (default patch): `make publish BUMP=minor`
BUMP ?= patch
