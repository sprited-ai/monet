#!/bin/bash
# provision-guest.sh — runs INSIDE the macOS VM. Idempotent. Image-agnostic.
#
# Works on BOTH cirruslabs images:
#   * macos-sequoia-base    -> already has brew + Node 24 + (via brew's bootstrap) CLT/swiftc.
#                              ensure_node() is a no-op here; this is WHY base over-estimates
#                              a stranger's success (see test-plan / host-clean.sh).
#   * macos-sequoia-vanilla -> nothing: no brew, no git, no Node, no CLT/swiftc.
#                              ensure_node() installs Node from the official arm64 tarball.
#
# It does what the README's "Quick start" tells a stranger (npm install && npm start),
# but first GUARANTEES the one hard prereq (Node >=18) and REPORTS the optional one (swiftc).
#
# Driven from the host by host-base.sh (base, via `tart exec`) or host-clean.sh (vanilla, via ssh).
#
# Knobs (env):
#   APP_DIR  where the repo already sits / will run   (default: $HOME/app)
#   NODE_MIN required Node major                       (default: 18)
#   NODE_VER pinned LTS for the from-scratch tarball   (default: v22.23.1 = current "Jod" LTS)
#   RUN_APP  1 = also `npm start` the Electron app     (default: 1; set 0 for install-only)
set -uo pipefail

APP_DIR="${APP_DIR:-$HOME/app}"
NODE_MIN="${NODE_MIN:-18}"
NODE_VER="${NODE_VER:-v22.23.1}"
RUN_APP="${RUN_APP:-1}"
ARCH="arm64"                              # Apple Silicon guest

log(){ printf '\n=== %s ===\n' "$*"; }

# --- 1. Node >= NODE_MIN ----------------------------------------------------
node_major(){ command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

ensure_node(){
  if [ "$(node_major)" -ge "$NODE_MIN" ]; then
    log "Node OK: $(node -v) (>= $NODE_MIN) — nothing to install"; return 0
  fi
  # Path A: Homebrew present (cirruslabs *-base) -> cheapest, current Node.
  if command -v brew >/dev/null 2>&1; then
    log "Installing Node via Homebrew"; brew install node && { hash -r; return 0; }
  fi
  # Path B: from-scratch (vanilla: no brew, no CLT). Official prebuilt arm64 tarball -> /usr/local.
  # Lightest headless path: no compiler, no CLT, no GUI, no brew. /usr/local/bin is on the default
  # macOS PATH (/etc/paths) so non-login shells (ssh / tart exec) pick it up.
  # (Alternative a real consumer would use: the universal .pkg from nodejs.org via
  #  `sudo installer -pkg node-${NODE_VER}.pkg -target /`. Heavier (both arches); same result.)
  log "Installing Node $NODE_VER from official arm64 tarball (no brew/CLT)"
  local tgz="/tmp/node.tar.gz" dir="node-${NODE_VER}-darwin-${ARCH}"
  /usr/bin/curl -fsSL "https://nodejs.org/dist/${NODE_VER}/${dir}.tar.gz" -o "$tgz" || return 1
  sudo mkdir -p /usr/local
  sudo tar -xzf "$tgz" -C /usr/local --strip-components=1
  hash -r
  node -v && npm -v
}

ensure_node || { echo "FATAL: could not provide Node >= $NODE_MIN"; exit 2; }

# --- 2. Optional: swiftc screen-read helpers --------------------------------
# package.json postinstall: `swiftc ... || echo 'skip native build (no swiftc) ...'` — so the app
# degrades gracefully. swiftc ships with Xcode Command Line Tools, which a CLEAN consumer Mac does
# NOT have. We DELIBERATELY do not run `xcode-select --install`: it is a BIG, GUI/interactive
# install that cannot be scripted headlessly. Screen-read is the only feature lost without it.
if xcrun --find swiftc >/dev/null 2>&1; then
  log "swiftc present: $(swiftc --version 2>/dev/null | head -1) — screen-read helpers WILL build"
else
  log "swiftc ABSENT — screen-read DISABLED (expected on a clean Mac; everything else runs)"
  echo "  enable later (optional, skippable): xcode-select --install   # BIG, interactive/GUI"
fi

# --- 3. Run the app exactly as the README's Quick start ---------------------
cd "$APP_DIR" || { echo "FATAL: no app at $APP_DIR"; exit 3; }
log "npm install   (also runs postinstall -> swiftc build OR graceful skip)"
npm install || { echo "FATAL: npm install failed"; exit 4; }

[ "$RUN_APP" = "1" ] || { log "RUN_APP=0 — install-only, done"; exit 0; }

log "npm start (Electron)"
# GOTCHA: a GUI app must launch in the Aqua (auto-logged-in) session, NOT the ssh/exec bootstrap
# context, or it can't reach WindowServer. `launchctl asuser <uid>` bridges into that session.
# VERIFY AT RUNTIME: if Electron doesn't appear, fall back to running `npm start` from a Terminal
# inside the `tart run` graphics window (or `osascript -e 'tell app "Terminal" to do script ...'`).
UID_NUM="$(id -u)"
launchctl asuser "$UID_NUM" /bin/bash -lc "cd '$APP_DIR' && nohup npm start >/tmp/monet-start.log 2>&1 &"
sleep 25
log "start log (last 40 lines):"
tail -40 /tmp/monet-start.log 2>/dev/null || echo "(no log yet)"
log "running electron processes:"
pgrep -lf 'Electron|electron' || echo "(none — see GUI-session gotcha above)"
