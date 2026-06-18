# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, email **rithellyenzo@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof-of-concept if you have one),
- the Beacon version (`beacon --version`) and your OS.

You can expect an acknowledgement within a few days. We'll work with you on a fix and coordinate
disclosure once a patch is available.

## Scope

Beacon is **local-first**: each user's boards live in per-workspace SQLite on their own machine
(`~/.beacon/<id>/`), and there is no production database of user content. The areas most relevant to
security are:

- **The local daemon and CLI** (`bin/`, the Next server) — anything that could let a malicious repo,
  file, or web origin reach the local server, read other workspaces, or execute code.
- **The MCP server and agent hooks** — the bridge between your terminal agent and Beacon.
- **The shared deploy services** — the small shared Neon Postgres holding only the anonymous feedback
  board and aggregate telemetry counters, and the read-only shared-board snapshots. These never hold
  user board data.

## What we collect

Beacon sends an anonymous heartbeat (at most every 12 hours) with exactly five fields: a random
machine id, the Beacon version, OS, CPU architecture, and a CI flag. No repo names, file paths, code,
plans, or board content; IP addresses are not stored. Inspect the payload with
`beacon telemetry status` and opt out with `beacon telemetry off`, `BEACON_TELEMETRY_DISABLED=1`, or
`DO_NOT_TRACK=1`.
