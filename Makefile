.PHONY: install up down build test test-watch lint db-up db-reset studio db-postgres deploy watch dev

install:    ## install deps
	bun install

up:         ## run the control app dev server (http://localhost:3000)
	bun run dev

watch:      ## run the live code-intelligence watcher (control app must be up)
	bun run intel/watch.ts

dev:        ## run control app + intel watcher together (Ctrl-C stops both)
	@bash -c 'bun run dev & DEV=$$!; trap "kill $$DEV 2>/dev/null" EXIT; sleep 2; bun run intel/watch.ts'

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
