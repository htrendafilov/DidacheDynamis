#!/usr/bin/env bash
# Local dev: build content when needed, then run FastAPI and Vite together.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMPORTER="$ROOT/apps/importer/.venv/bin/bibleimport"
UVICORN="$ROOT/apps/api/.venv/bin/uvicorn"
DB="$ROOT/data/content.sqlite"

for executable in "$IMPORTER" "$UVICORN"; do
  if [ ! -x "$executable" ]; then
    echo "missing $executable — follow docs/developer/index.md first" >&2
    exit 1
  fi
done
if [ ! -d "$ROOT/apps/web/node_modules" ]; then
  echo "missing apps/web/node_modules — run: cd apps/web && npm ci" >&2
  exit 1
fi

if [ "${REBUILD_CONTENT:-0}" = "1" ] || [ ! -f "$DB" ]; then
  bash "$ROOT/scripts/fetch-kjv.sh"
  "$IMPORTER" build-all \
    --sources-dir "$ROOT/data/sources" \
    --out "$DB"
fi

cleanup() {
  kill "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

CONTENT_DB_PATH="$DB" "$UVICORN" app.main:app \
  --app-dir "$ROOT/apps/api" \
  --reload \
  --host 127.0.0.1 \
  --port "${API_PORT:-8080}" &
API_PID=$!

(
  cd "$ROOT/apps/web"
  npm run dev -- --host 127.0.0.1 --port "${WEB_PORT:-5173}"
) &
WEB_PID=$!

echo "API: http://127.0.0.1:${API_PORT:-8080}"
echo "Web: http://127.0.0.1:${WEB_PORT:-5173}"
while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
echo "one development server stopped; shutting down the other" >&2
exit 1
