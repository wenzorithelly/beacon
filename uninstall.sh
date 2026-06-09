#!/usr/bin/env bash
# Beacon uninstaller — clean removal counterpart to install.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/beacon/main/uninstall.sh | sh
#
# What it does:
#   1. Runs `beacon uninstall --yes` if the CLI is reachable — this strips every
#      Beacon artifact from ~/.claude/, every registered repo's .mcp.json /
#      AGENTS.md / CLAUDE.md / skills, and wipes ~/.beacon/.
#   2. Removes the symlink at $BEACON_BIN.
#   3. Removes the source tree at $BEACON_DIR (the cloned repo).
#
# Override anything via env (must match install.sh):
#   BEACON_DIR=$HOME/.beacon-cli
#   BEACON_BIN=$HOME/.local/bin/beacon

set -eu

BEACON_DIR="${BEACON_DIR:-$HOME/.beacon-cli}"
BEACON_BIN="${BEACON_BIN:-$HOME/.local/bin/beacon}"

if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); RESET=$(printf '\033[0m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m')
else
  BOLD=""; RESET=""; GREEN=""; YELLOW=""
fi
say()  { printf "%s[beacon]%s %s\n" "$BOLD" "$RESET" "$1"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }

# ── 1. Clean Beacon artifacts via the CLI ─────────────────────────────────────
if command -v beacon >/dev/null 2>&1; then
  say "Removing Beacon artifacts via \`beacon uninstall --yes\`…"
  beacon uninstall --yes || warn "beacon uninstall exited non-zero — continuing with file cleanup."
elif [ -x "$BEACON_BIN" ] || [ -L "$BEACON_BIN" ]; then
  say "Removing Beacon artifacts via $BEACON_BIN uninstall --yes…"
  "$BEACON_BIN" uninstall --yes || warn "beacon uninstall exited non-zero — continuing."
else
  warn "beacon binary not found on PATH or at $BEACON_BIN — skipping artifact cleanup."
  warn "If you have Beacon entries in ~/.claude/settings.json or per-repo .mcp.json files, remove them manually."
fi

# ── 2. Symlink ────────────────────────────────────────────────────────────────
if [ -L "$BEACON_BIN" ] || [ -e "$BEACON_BIN" ]; then
  rm -f "$BEACON_BIN"
  ok "removed $BEACON_BIN"
fi

# ── 3. Source tree ────────────────────────────────────────────────────────────
if [ -d "$BEACON_DIR" ]; then
  rm -rf "$BEACON_DIR"
  ok "removed $BEACON_DIR"
fi

printf "\n%sDone.%s Beacon is gone. (If you still see %s~/.beacon%s, remove it manually — it should already be wiped.)\n\n" "$BOLD" "$RESET" "$BOLD" "$RESET"
