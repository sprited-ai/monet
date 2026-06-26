#!/bin/bash
# host-base.sh — drive the BASE VM (monet-vm) from the HOST.
# Use this for GOAL A (clean facade screenshot) and fast iteration. NOTE: because the base image
# already has Node 24 + (via brew) CLT/swiftc, a successful clone-and-run here PROVES NOTHING about
# a clean stranger Mac — for that, use host-clean.sh (the faithful test).
#
# Prereqs: image finished downloading; VM created+booted by the orchestrator. Base ships the
# tart-guest-agent, so we drive it with `tart exec` (no SSH needed).
set -euo pipefail

TART="${TART:?set TART to the tart binary, e.g. .../tart.app/Contents/MacOS/tart}"
VM="${VM:-monet-vm}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${SRC:-/Users/jin/dev/monet/apps/desktop}"   # local app to test
REPO_URL="${REPO_URL:-}"     # if set, guest `git clone`s this; else we stream the local repo in
GUEST_USER="${GUEST_USER:-admin}"
APP_DIR="/Users/${GUEST_USER}/app"

# 1. Right-size: 16GB host -> 6GB guest; believable laptop display for the marketing facade.
"$TART" set "$VM" --cpu 4 --memory 6144 --display 1600x1000
# (orchestrator boots, e.g.: "$TART" run "$VM"        # windowed, good for the screenshot
#                       or:  "$TART" run "$VM" --no-graphics & )

echo "Waiting for guest IP (dhcp resolver; agent not required for ip)..."
"$TART" ip "$VM" --wait 180

echo "Confirm the macOS patch we actually got (Goal: just record it):"
"$TART" exec "$VM" /usr/bin/sw_vers

# 2. Get the app into the guest at ~/app
if [ -n "$REPO_URL" ]; then
  "$TART" exec "$VM" /bin/bash -lc "rm -rf '$APP_DIR' && git clone '$REPO_URL' '$APP_DIR'"
else
  # Repo not published yet -> stream the local copy in (excludes node_modules + .git + native builds).
  tar czf - -C "$SRC" --exclude node_modules --exclude .git --exclude 'ax/monet-axread' --exclude 'ocr/monet-ocr' . \
    | "$TART" exec -i "$VM" /bin/bash -lc "rm -rf '$APP_DIR' && mkdir -p '$APP_DIR' && tar xzf - -C '$APP_DIR'"
fi

# 3. Provision + run (stream the guest script over stdin).
"$TART" exec -i "$VM" /usr/bin/env APP_DIR="$APP_DIR" NODE_MIN=18 RUN_APP=1 /bin/bash -s \
  < "$HERE/provision-guest.sh"

# 4. GOAL A — screenshot the clean desktop (+ Monet, if she launched).
#    screencapture must run in the GUI session (launchctl asuser). TCC NOTE: on Sequoia a full-screen
#    capture may need Screen Recording perm; cirruslabs pre-seeds some TCC grants, but VERIFY the PNG
#    isn't black. Fallback: host-side capture the `tart run` window with the host's own screencapture.
"$TART" exec "$VM" /bin/bash -lc 'launchctl asuser $(id -u) /usr/sbin/screencapture -x /tmp/facade.png'
"$TART" exec "$VM" /bin/cat /tmp/facade.png > "$HERE/facade.png"
echo "Saved $HERE/facade.png — open it and confirm: clean wallpaper, Dock at bottom, menubar clock, NO personal data."
