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
@AGENTS.md
<!-- beacon:end -->
