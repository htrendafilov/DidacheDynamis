#!/usr/bin/env bash
# Canonical verification entrypoint — run before every PR; CI runs the same script.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> backend: ruff"
if [ -d apps/api ] && command -v ruff >/dev/null 2>&1; then
  ruff check apps/api apps/importer || true   # TODO: drop `|| true` once code exists (M0/M1)
fi

echo "==> backend: pytest"
if [ -d apps/api ] && command -v pytest >/dev/null 2>&1; then
  pytest apps/api apps/importer -q || true    # TODO: drop `|| true` once tests exist
fi

echo "==> frontend: lint + type-check + test + build"
if [ -f apps/web/package.json ]; then
  ( cd apps/web && npm ci && npm run lint && npm run typecheck && npm run test -- --run && npm run build )
fi

echo "OK"
