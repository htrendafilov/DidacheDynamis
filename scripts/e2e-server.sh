#!/usr/bin/env bash
# Serve the full stack (FastAPI + built SPA + read-only content.sqlite) on one port for
# Playwright E2E. Builds the DB and SPA if they are missing. Used by playwright.config.ts.
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${E2E_PORT:-4321}"

if [ ! -f data/content.sqlite ]; then
  if [ -x apps/importer/.venv/bin/bibleimport ]; then BI=apps/importer/.venv/bin/bibleimport; else BI="python3 -m bibleimport"; fi
  echo "e2e: building content.sqlite…"
  $BI build-all --sources-dir data/sources --out data/content.sqlite
fi

if [ ! -f apps/web/dist/index.html ]; then
  echo "e2e: building SPA…"
  ( cd apps/web && npm run build )
fi

if [ -x apps/api/.venv/bin/uvicorn ]; then UV=apps/api/.venv/bin/uvicorn; else UV=uvicorn; fi
echo "e2e: serving on http://127.0.0.1:${PORT}"
exec env CONTENT_DB_PATH="$PWD/data/content.sqlite" WEB_DIST_PATH="$PWD/apps/web/dist" \
  "$UV" app.main:app --app-dir apps/api --host 127.0.0.1 --port "$PORT" --log-level warning
