# Deployment docs

- [`deployment_design.md`](deployment_design.md) — the portable, public deployment architecture
  (systemd + Gunicorn vs GHCR/Docker, Cloudflare Tunnel, release/rollback strategy).
- **The live operator runbook is intentionally not published.** It contains the production origin
  address, operator account, and secret-store layout, and lives in an operator-controlled location
  outside this repository (git-ignored as `plan/deployment/live-runbook.md`). Generic operational
  procedures that are safe to publish live in [`docs/deployment/`](../../docs/deployment/index.md).
