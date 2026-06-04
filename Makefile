.PHONY: install up down build test test-watch lint db-up db-reset seed studio db-postgres deploy

install:    ## install deps
	bun install

up:         ## run dev server (http://localhost:3000)
	bun run dev

down:       ## no daemon — stop the dev server with Ctrl-C
	@echo "No background daemon. Stop the dev server with Ctrl-C."

build:      ## production build (generates prisma client first)
	bun run build

test:       ## run the test suite once
	bun run test

test-watch: ## run tests in watch mode
	bun run test:watch

lint:       ## lint
	bun run lint

db-up:      ## create/apply a dev migration
	bunx prisma migrate dev

db-reset:   ## drop + re-migrate + seed (local only)
	bunx prisma migrate reset --force

seed:       ## seed the database from prisma/seed.ts
	bun run db:seed

studio:     ## open Prisma Studio
	bunx prisma studio

db-postgres: ## deploy-time: set provider=postgresql + Neon DATABASE_URL, then run this
	@echo "1) set datasource provider to postgresql in prisma/schema.prisma"
	@echo "2) swap lib/db.ts adapter to @prisma/adapter-neon (or -pg)"
	@echo "3) set DATABASE_URL to the Neon URL, then: bunx prisma migrate deploy"

deploy:     ## deploy to Vercel (prod)
	bunx prisma migrate deploy && bunx vercel --prod
