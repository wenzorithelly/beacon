# Codex Integration Hardening Design

## Goal

Make Beacon's Codex installation, lifecycle hooks, and user guidance safe, idempotent, and accurate.

## Design

Beacon owns only the `[mcp_servers.beacon]` TOML table and its two marker comments. Uninstall will remove that table and those comments while preserving any foreign tables inserted between the markers by Codex Desktop or the user.

For Codex events whose matchers are ignored (`UserPromptSubmit` and `Stop`), setup will retain one Beacon command and remove duplicate Beacon commands. It will preserve unrelated hook handlers and avoid adding a second handler when a legacy matcherless entry already works.

The `PostToolUse` delivery request will have a short abort timeout, matching the other best-effort hooks. Codex-only guidance will direct agents to `beacon_present_plan` or `beacon_propose_plan`; it will not claim that Codex supports `ExitPlanMode`.

## Validation

Tests will cover foreign TOML preservation, duplicate hook collapse, legacy matcherless hook reuse, bounded edit delivery, and Codex-facing guidance. The focused integration suite and complete `make test` suite must pass.
