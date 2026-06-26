#!/usr/bin/env bash
# Launch Monet — the desktop-first embodied agent — with one command from the repo root.
#   npm run dev      (this — wakes her on your desktop; `npm run desktop` is an alias)
#   npm run dev:web  (just her body in the browser, no overlay window)
#
# Brings up everything: ensures the npm workspace is installed (Electron + the on-device
# screen-read Swift helpers, built by apps/desktop's postinstall), ensures the dev server that
# serves her body (apps/web → /desktop + worker) is running, then launches the shell in the
# foreground (Ctrl-C / closing her stops it).

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/apps/desktop"
# Dev port: default 1874 (clear of 3000/5173/8080/8788). Export so the vite dev server we spawn
# below binds the same port the shell loads from.
PORT="${MONET_PORT:-1874}"
export MONET_PORT="$PORT"
URL="http://localhost:$PORT/desktop"

# First run: install the whole workspace once from the root (npm workspaces hoists Electron +
# apps/web deps; apps/desktop's postinstall compiles the Swift screen-read helpers).
if [ ! -x "$ROOT/node_modules/.bin/electron" ]; then
  echo "→ first run: installing the workspace (npm install)…"
  ( cd "$ROOT" && npm install )
fi

# Ensure the dev server is up (serves her body + the worker API). Reuse one if it's already there.
if ! curl -fsS -o /dev/null "$URL" 2>/dev/null; then
  echo "→ starting dev server (apps/web) … logs: .desktop-devserver.log"
  ( cd "$ROOT" && npm run dev -w @monet/web > "$ROOT/.desktop-devserver.log" 2>&1 & )
  printf "→ waiting for :%s " "$PORT"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$URL" 2>/dev/null; then echo "✓"; break; fi
    printf "."
    sleep 1
  done
fi

echo "→ waking Monet 🎨"
cd "$APP" && exec npm start
