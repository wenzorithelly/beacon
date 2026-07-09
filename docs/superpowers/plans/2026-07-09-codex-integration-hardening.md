# Codex Integration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Beacon's Codex integration safe to install, uninstall, and operate.

**Architecture:** Keep the generic hook helpers reusable, add Codex-specific migration semantics at the installer boundary, and delete only the exact TOML table Beacon owns. Tests reproduce each observed failure before production code changes.

**Tech Stack:** TypeScript, Bun test, Codex lifecycle hooks, TOML configuration.

## Global Constraints

- Preserve user-owned Codex configuration and unrelated hooks.
- Use `apply_patch` for edits and Bun for tests.
- Keep agent-facing copy in English and UI copy agent-neutral.

---

### Task 1: Safe Codex MCP removal

**Files:**
- Modify: `tests/codex-install.test.ts`
- Modify: `lib/codex-install.ts`

- [ ] Write a failing uninstall test with a foreign `[mcp_servers.computer-use]` table inside Beacon's markers.
- [ ] Run `bun test tests/codex-install.test.ts` and confirm the foreign table is deleted by the current implementation.
- [ ] Remove only Beacon's table and marker comments, preserving every foreign TOML line.
- [ ] Re-run the focused test.

### Task 2: Idempotent Codex lifecycle hooks

**Files:**
- Modify: `tests/agent-config.test.ts`
- Modify: `tests/codex-install.test.ts`
- Modify: `lib/agent-config.ts`
- Modify: `lib/codex-install.ts`

- [ ] Write failing tests for legacy matcherless hooks and duplicate Beacon prompt/stop hooks.
- [ ] Run the focused tests and confirm setup adds or leaves duplicate commands today.
- [ ] Add command-level deduplication only for matcherless Codex events, preserving unrelated commands.
- [ ] Re-run the focused tests.

### Task 3: Bounded hook delivery and Codex guidance

**Files:**
- Modify: `tests/hook-files.test.ts`
- Modify: `bin/hook.ts`
- Modify: `AGENTS.md`
- Modify: `app/help/page.tsx`
- Modify: `components/docs/docs.tsx`

- [ ] Write a failing source-contract test requiring an abort signal on the delivery fetch.
- [ ] Run it and confirm the current hook has no signal.
- [ ] Add a short abort timeout and revise Codex guidance away from `ExitPlanMode`.
- [ ] Re-run focused tests and `make test`.
