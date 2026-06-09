#!/bin/sh
# Beacon installer — https://trybeacon.sh
#
#   curl -fsSL https://trybeacon.sh/install.sh | sh
#
# Installs the `beacon` CLI globally with Bun (Beacon's runtime). Safe to re-run any time —
# it just updates to the latest version. Nothing here needs root.
set -eu

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
case ":${PATH}:" in
  *":${BUN_BIN}:"*) : ;;
  *) say "  ${DIM}Add Bun's global bin to your PATH (then restart your shell):${RESET}"
     say "      export PATH=\"${BUN_BIN}:\$PATH\"" ;;
esac
say ""
say "  Next:  cd into any repo and run  ${ORANGE}beacon${RESET}"
say "  Docs:  https://trybeacon.sh"
say ""
