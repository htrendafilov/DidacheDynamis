#!/usr/bin/env bash
# Canonical verification entrypoint — run before every PR; CI runs the same script.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> importer: ruff + pytest"
if [ -f apps/importer/pyproject.toml ]; then
  ruff check apps/importer
  python3 -m pytest apps/importer -q
fi

echo "==> api: ruff + pytest"
if [ -f apps/api/pyproject.toml ]; then
  ruff check apps/api
  python3 -m pytest apps/api -q
fi

echo "==> frontend: lint + type-check + test + build"
if [ -f apps/web/package.json ]; then
  ( cd apps/web && npm ci && npm run lint && npm run typecheck && npm run test -- --run && npm run build )
fi

echo "OK"
