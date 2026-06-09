#!/usr/bin/env bash
# Beacon installer — one-liner entry point for new machines.
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/beacon/main/install.sh | sh
#
# What it does:
#   1. Ensures `bun` is installed (uses the official bun.sh installer if missing).
#   2. Clones (or refreshes) the Beacon source into ~/.beacon-cli/.
#   3. `bun install` in that directory.
#   4. Symlinks the CLI onto your PATH (~/.local/bin/beacon by default).
#   5. Runs `beacon doctor` so you can see what got wired vs. what still needs setup.
#
# Override anything via env:
#   BEACON_REPO=https://github.com/your-org/beacon.git
#   BEACON_BRANCH=main
#   BEACON_DIR=$HOME/.beacon-cli
#   BEACON_BIN=$HOME/.local/bin/beacon

set -eu

BEACON_REPO="${BEACON_REPO:-https://github.com/wenzorithelly/beacon.git}"
BEACON_BRANCH="${BEACON_BRANCH:-main}"
BEACON_DIR="${BEACON_DIR:-$HOME/.beacon-cli}"
BEACON_BIN="${BEACON_BIN:-$HOME/.local/bin/beacon}"

# ── Colors ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); RESET=$(printf '\033[0m')
  GREEN=$(printf '\033[32m'); YELLOW=$(printf '\033[33m'); RED=$(printf '\033[31m')
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; YELLOW=""; RED=""
fi
say()  { printf "%s[beacon]%s %s\n" "$BOLD" "$RESET" "$1"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$1"; }
warn() { printf "  %s!%s %s\n" "$YELLOW" "$RESET" "$1"; }
err()  { printf "  %s✗%s %s\n" "$RED" "$RESET" "$1" >&2; }
die()  { err "$1"; exit 1; }

# ── 1. Bun ────────────────────────────────────────────────────────────────────
say "Checking for bun…"
if ! command -v bun >/dev/null 2>&1; then
  warn "bun not found — installing via https://bun.sh/install"
  curl -fsSL https://bun.sh/install | bash
  # Source the bun snippet so `bun` is on PATH in this shell.
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun install completed but \`bun\` is still not on PATH. Add $BUN_INSTALL/bin to your shell PATH and re-run."
fi
ok "bun $(bun --version)"

# ── 2. Source tree ────────────────────────────────────────────────────────────
say "Fetching Beacon source → $BEACON_DIR"
if [ -d "$BEACON_DIR/.git" ]; then
  git -C "$BEACON_DIR" fetch --depth 1 origin "$BEACON_BRANCH"
  git -C "$BEACON_DIR" reset --hard "origin/$BEACON_BRANCH"
  ok "updated to latest $BEACON_BRANCH"
else
  if [ -e "$BEACON_DIR" ]; then
    die "$BEACON_DIR exists and is not a git checkout. Move it aside or set BEACON_DIR= to a different path."
  fi
  git clone --depth 1 --branch "$BEACON_BRANCH" "$BEACON_REPO" "$BEACON_DIR"
  ok "cloned $BEACON_REPO@$BEACON_BRANCH"
fi

# ── 3. bun install ────────────────────────────────────────────────────────────
say "Installing dependencies…"
( cd "$BEACON_DIR" && bun install --frozen-lockfile ) >/dev/null
ok "dependencies ready"

# ── 4. Symlink onto PATH ──────────────────────────────────────────────────────
say "Linking beacon → $BEACON_BIN"
mkdir -p "$(dirname "$BEACON_BIN")"
ln -sf "$BEACON_DIR/bin/beacon.ts" "$BEACON_BIN"
chmod +x "$BEACON_BIN" 2>/dev/null || true
ok "linked"

case ":$PATH:" in
  *":$(dirname "$BEACON_BIN"):"*) ;;
  *)
    warn "$(dirname "$BEACON_BIN") is NOT on your PATH."
    warn "Add this line to your shell rc and reopen the terminal:"
    printf "    %sexport PATH=\"$(dirname "$BEACON_BIN"):\$PATH\"%s\n" "$DIM" "$RESET"
    ;;
esac

# ── 5. Doctor + first-run hint ───────────────────────────────────────────────
say "Verifying…"
if "$BEACON_BIN" doctor >/dev/null 2>&1; then
  "$BEACON_BIN" doctor
fi

printf "\n%sNext steps%s\n" "$BOLD" "$RESET"
printf "  • In any repo, run %sbeacon%s to open the panel and wire Beacon into that repo.\n" "$BOLD" "$RESET"
printf "  • Restart any open Claude Code sessions so they pick up the global hooks + skills.\n"
printf "  • To remove everything later: %sbeacon uninstall --yes%s then re-run %suninstall.sh%s.\n\n" "$BOLD" "$RESET" "$BOLD" "$RESET"
