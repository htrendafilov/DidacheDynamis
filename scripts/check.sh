#!/usr/bin/env bash
# Canonical verification entrypoint — run before every PR; CI runs the same script.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> importer: ruff + pytest"
if [ -f apps/importer/pyproject.toml ]; then
  if [ -x apps/importer/.venv/bin/python ]; then
    IMPORTER_PY=apps/importer/.venv/bin/python
    RUFF=apps/importer/.venv/bin/ruff
  else
    IMPORTER_PY=python3
    RUFF=ruff
  fi
  "$RUFF" check apps/importer
  "$IMPORTER_PY" -m pytest apps/importer -q
fi

echo "==> api: ruff + pytest"
if [ -f apps/api/pyproject.toml ]; then
  if [ -x apps/api/.venv/bin/python ]; then
    API_PY=apps/api/.venv/bin/python
  else
    API_PY=python3
  fi
  "$RUFF" check apps/api
  "$API_PY" -m pytest apps/api -q
fi

echo "==> frontend: lint + type-check + test + build"
if [ -f apps/web/package.json ]; then
  ( cd apps/web && npm ci && npm run lint && npm run typecheck && npm run test -- --run && npm run build )
fi

echo "OK"
