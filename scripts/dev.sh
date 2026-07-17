#!/usr/bin/env bash
# Local dev: run the API (with a content.sqlite) and the Vite dev server.
set -euo pipefail
cd "$(dirname "$0")/.."

# API (FastAPI/uvicorn) on :8080 — added in M0/M1
# ( cd apps/api && uvicorn app.main:app --reload --port "${API_PORT:-8080}" ) &

# Web (Vite) on :5173 — added in M0
# ( cd apps/web && npm run dev )

echo "dev.sh: uncomment the service blocks once apps/api and apps/web exist (M0)."
