#!/usr/bin/env bash
# Serve the full stack (FastAPI + built SPA + read-only content.sqlite) on one port for
# Playwright E2E. Used by playwright.config.ts.
#
# By default this REBUILDS the DB and SPA so local `npm run e2e` never tests stale artifacts.
# Set E2E_REUSE=1 to skip rebuilding when the artifacts already exist (CI builds them in an
# explicit prior step and sets this to avoid a redundant rebuild).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${E2E_PORT:-4321}"
REUSE="${E2E_REUSE:-0}"

if [ -x apps/importer/.venv/bin/bibleimport ]; then BI=apps/importer/.venv/bin/bibleimport; else BI=bibleimport; fi

if [ "$REUSE" != "1" ] || [ ! -f data/content.sqlite ]; then
  echo "e2e: building content.sqlite…"
  $BI build-all --sources-dir data/sources --out data/content.sqlite
fi

if [ "$REUSE" != "1" ] || [ ! -f apps/web/dist/index.html ]; then
  echo "e2e: building SPA…"
  ( cd apps/web && npm run build )
fi

if [ -x apps/api/.venv/bin/uvicorn ]; then UV=apps/api/.venv/bin/uvicorn; else UV=uvicorn; fi
echo "e2e: serving on http://127.0.0.1:${PORT}"
exec env CONTENT_DB_PATH="$PWD/data/content.sqlite" WEB_DIST_PATH="$PWD/apps/web/dist" \
  "$UV" app.main:app --app-dir apps/api --host 127.0.0.1 --port "$PORT" --log-level warning
