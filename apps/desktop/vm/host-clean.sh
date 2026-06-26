#!/bin/bash
# host-clean.sh — THE FAITHFUL CLEAN-MAC BARRIER TEST, on the TOOLLESS vanilla image.
#
# WHY a second VM: macos-sequoia-base ships Node 24 + brew + (brew's bootstrap) CLT/swiftc, so it
# silently satisfies every prereq and clone-and-run "just works" there — telling you NOTHING about a
# real stranger. macos-sequoia-vanilla has none of it (no brew, no git, no Node, no CLT). It is the
# honest analog of a fresh consumer Mac, so it surfaces the REAL prereqs.
#
# Vanilla has NO tart-guest-agent -> `tart exec` is unavailable. We drive it over SSH (admin/admin,
# Remote Login is enabled on cirruslabs images) using /usr/bin/expect (ships with base macOS; no CLT).
set -uo pipefail

TART="${TART:?set TART}"
VM="${VM:-monet-vm-clean}"
USERNAME="${USERNAME:-admin}"; PW="${PW:-admin}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="${SRC:-/Users/jin/dev/monet/apps/desktop}"

# 0. ONE-TIME: pull the toolless image (~25-40GB, slow — do once) + size it. Orchestrator can boot.
#   "$TART" clone ghcr.io/cirruslabs/macos-sequoia-vanilla:latest "$VM"
#   "$TART" set "$VM" --cpu 4 --memory 6144 --display 1600x1000
#   "$TART" run "$VM" --no-graphics &
IP="$("$TART" ip "$VM" --wait 240)"; echo "VM IP: $IP"

SSHOPT="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
# run a remote command over password SSH
sshx(){ /usr/bin/expect -c "
  set timeout 900
  spawn ssh $SSHOPT ${USERNAME}@${IP} $1
  expect { \"assword:\" { send \"${PW}\r\"; exp_continue } eof }
"; }
# copy a local file in over password SCP
scpx(){ /usr/bin/expect -c "
  set timeout 900
  spawn scp $SSHOPT \"$1\" ${USERNAME}@${IP}:\"$2\"
  expect { \"assword:\" { send \"${PW}\r\"; exp_continue } eof }
"; }

echo "############ PHASE 1 — BARRIER CAPTURE ############"
echo "# Run the README's Quick start preconditions VERBATIM. Record EXACTLY what a stranger hits."
sshx "'echo OS:; sw_vers; echo; echo git:; git --version 2>&1; echo; echo node:; node --version 2>&1; echo; echo npm:; npm --version 2>&1; echo; echo swiftc:; xcrun --find swiftc 2>&1'"
# EXPECTED on vanilla (this IS the deliverable — the true prereqs the README under-states):
#   git    -> "no developer tools were found" / would pop the CLT installer  => `git clone` is a barrier
#   node   -> command not found                                             => Node install is a barrier
#   npm    -> command not found                                             => (same)
#   swiftc -> not found                                                     => screen-read off (README calls this "optional"; fine)

echo "############ PHASE 2 — make it run the stranger's way, then screenshot ############"
# git itself is missing, so a stranger would download the repo zip, not `git clone`. We mirror that
# by shipping a tarball instead of cloning:
tar czf /tmp/monet-app.tgz -C "$SRC" --exclude node_modules --exclude .git --exclude 'ax/monet-axread' --exclude 'ocr/monet-ocr' .
scpx /tmp/monet-app.tgz "/tmp/monet-app.tgz"
scpx "$HERE/provision-guest.sh" "/tmp/provision-guest.sh"
sshx "'mkdir -p ~/app && tar xzf /tmp/monet-app.tgz -C ~/app'"
# provisioner installs Node from the official arm64 tarball (no brew/CLT), then npm install && npm start:
sshx "'env APP_DIR=/Users/${USERNAME}/app NODE_MIN=18 RUN_APP=1 bash /tmp/provision-guest.sh'"

# screenshot (GUI session; same TCC caveat as host-base.sh)
sshx "'launchctl asuser \$(id -u) /usr/sbin/screencapture -x /tmp/clean.png'"
scpx_back(){ /usr/bin/expect -c "
  set timeout 300
  spawn scp $SSHOPT ${USERNAME}@${IP}:/tmp/clean.png \"$HERE/clean.png\"
  expect { \"assword:\" { send \"${PW}\r\"; exp_continue } eof }
"; }
scpx_back
echo "Saved $HERE/clean.png. PHASE 1 output above is the real finding: what a stranger must install before this app runs."
