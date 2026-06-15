#!/bin/sh
# Beacon installer — https://trybeacon.sh
#
#   curl -fsSL https://trybeacon.sh/install.sh | sh
#
# Installs the `beacon` CLI globally with Bun (Beacon's runtime). Safe to re-run any time —
# it just updates to the latest version. Nothing here needs root.
set -eu

# The user's interactive PATH, captured BEFORE we prepend Bun's bin below. A piped `curl … | sh`
# runs in a child process and can't change the parent shell, so the end-of-script guidance must
# be decided off this — the shell beacon will actually be typed in — not the PATH we mutate here.
ORIGINAL_PATH="$PATH"

# ---- pretty output (only when attached to a terminal) --------------------------------------
if [ -t 1 ]; then
  BOLD='\033[1m'; ORANGE='\033[38;5;208m'; DIM='\033[2m'; RESET='\033[0m'
else
  BOLD=''; ORANGE=''; DIM=''; RESET=''
fi
say() { printf '%b\n' "$*"; }

say ""
say "  ${ORANGE}▲ Beacon${RESET} — the visual planning surface for the coding agent in your terminal"
say ""

# ---- 1. ensure Bun -------------------------------------------------------------------------
# Beacon's CLI and server both run on Bun. If it's missing, install it (no root needed); if it's
# installed but not yet on this shell's PATH, pick it up from its default location.
if ! command -v bun >/dev/null 2>&1; then
  BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  if [ ! -x "$BUN_INSTALL/bin/bun" ]; then
    say "  ${DIM}Bun not found — installing it…${RESET}"
    curl -fsSL https://bun.sh/install | bash
  fi
  PATH="$BUN_INSTALL/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
  say "  Could not find or install Bun. Install it from ${BOLD}https://bun.sh${RESET} and re-run."
  exit 1
fi

# ---- 2. install / update Beacon ------------------------------------------------------------
say "  ${DIM}Installing the beacon CLI — this pulls a few dependencies, give it a minute…${RESET}"
bun add -g trybeacon

# ---- 3. PATH hint + next steps -------------------------------------------------------------
BUN_BIN="$(bun pm bin -g 2>/dev/null || echo "${BUN_INSTALL:-$HOME/.bun}/bin")"
say ""
say "  ${BOLD}✓ Beacon installed.${RESET}"

# Decide off ORIGINAL_PATH — the shell the user will type `beacon` in. If Bun's global bin is
# already there, beacon just works. If not (e.g. we only added it to this script's PATH, or Bun's
# own installer appended an `export PATH` line that this shell hasn't sourced yet), the user would
# hit `beacon: command not found` despite a clean install — so spell out exactly how to fix it.
case ":${ORIGINAL_PATH}:" in
  *":${BUN_BIN}:"*)
    say ""
    say "  Next:  cd into any repo and run  ${ORANGE}beacon${RESET}" ;;
  *)
    # The rc the user's login shell reads — same file Bun's installer appends its PATH line to.
    case "${SHELL:-}" in
      */zsh)  RC="$HOME/.zshrc" ;;
      */bash) RC="$HOME/.bashrc" ;;
      */fish) RC="$HOME/.config/fish/config.fish" ;;
      *)      RC="" ;;
    esac
    say ""
    say "  ${BOLD}One more step${RESET} — beacon isn't on this terminal's PATH yet."
    # If neither the live PATH nor that rc already points at Bun's bin, the export line is missing.
    if [ -z "$RC" ] || ! grep -qF "$BUN_BIN" "$RC" 2>/dev/null; then
      say "  ${DIM}Add Bun's global bin to your shell profile:${RESET}"
      say "      ${BOLD}export PATH=\"${BUN_BIN}:\$PATH\"${RESET}"
    fi
    if [ -n "$RC" ]; then
      say "  ${DIM}Then reload this shell — or just open a new terminal:${RESET}"
      say "      ${BOLD}source ${RC}${RESET}"
    else
      say "  ${DIM}Then open a new terminal (or re-source your shell profile).${RESET}"
    fi
    say ""
    say "  After that:  cd into any repo and run  ${ORANGE}beacon${RESET}" ;;
esac
say "  Docs:  https://trybeacon.sh"
say ""
