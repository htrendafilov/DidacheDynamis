# Deployment Design (v1)

Current production is a native systemd service behind Cloudflare Tunnel. A portable Docker/GHCR path
remains supported. Live operator values (host, account, paths) are intentionally private — see
[`README.md`](README.md) in this directory — and [`../00_system_design.md`](../00_system_design.md)
defines the system boundary.

## 0. Hosting options

| Path | Status | Artifact |
|---|---|---|
| Native VM + systemd + Cloudflare Tunnel | **Current production** | virtualenv + versioned SPA + `content.sqlite` |
| VM/other host via Docker | Supported manual workflow | GHCR image containing SPA/API/content |
| Managed container host (for example Render) | Portable alternative, not current | same Docker image |

All paths retain the same stateless read-only runtime. Hosting prices/limits change and must be
rechecked at the time of a migration rather than treated as design constants here.

## 1. Target VM (surveyed)

The target VM (host + SSH user are kept in the `VM_HOST` / `VM_USER` **GitHub Actions secrets**, not
committed) — Debian 13, 4 vCPU (AMD EPYC-Genoa), 7.8 GB RAM (6.7 GB free), 232 GB disk free,
load ≈ 0.0 at the original survey. Caddy serves unrelated applications, but is not in this app's
request path; `cloudflared` reaches the Bible service on loopback. Capacity is verified with the load
smoke rather than inferred only from idle resources.

## 2. Portable artifact

One **Docker image** (multi-stage: Vite build → SPA; importer stage **builds `content.sqlite` from the
committed public-domain sources**; FastAPI runtime with Gunicorn+Uvicorn). The DB is baked in
(immutable, re-tag per content version) but never lives in git. This is what makes moving hosts a
one-liner: push image to GHCR, deploy elsewhere, repoint DNS.

## 3. CI and manual container deployment

The current live VM uses the native systemd/atomic-release procedure documented generically in
[`docs/deployment/`](../../docs/deployment/index.md) (operator values are private — see
[`README.md`](README.md) in this directory). The repository also retains a portable GHCR/Docker
deployment workflow:

**`ci.yml`** (PR + push): runs `scripts/check.sh` — backend ruff + pytest, frontend lint/type-check +
Vitest + `vite build`. Required check before merge to `main`.

**`publish-image.yml`** (**manual `workflow_dispatch`**, not triggered by a commit). Two jobs, and
the second does not run unless asked for:

*`publish` — always:*
1. Build the image (`deploy/Dockerfile`); tag with commit SHA + `latest`.
2. Push to **GHCR** (`ghcr.io/htrendafilov/bible_app_bg`).

*`deploy-to-vm` — only when the `deploy_to_vm` dispatch input is ticked (default off):*
3. **Deploy over SSH** (`SSH_DEPLOY_KEY` + `VM_HOST` repo secrets): connect as a limited deploy user,
   `docker compose pull && docker compose up -d` in `deploy/`, then a `/ready` smoke check.

The gate is deliberate: a workflow named for publishing must not change production as a side effect
of being dispatched, and publishing without deploying has to be a *successful* outcome rather than a
run that fails at the end.
4. **Rollback** = re-run the deploy with the previous SHA tag (or revert the commit).

The optional Dropbox notes feature needs the public `VITE_DROPBOX_APP_KEY` at SPA build time. Render
injects it as a Docker build argument; GHCR builds read repository secret `DROPBOX_APP_KEY`. The
app key is stored as a secret at the owner's request. The Dropbox app secret is never used. See the
setup steps in the repository README.

The shipped Content Security Policy includes `'self'`,
`https://api.dropboxapi.com`, and `https://content.dropboxapi.com`; otherwise Dropbox OAuth token
exchange and notes upload/download will fail. The access token is deliberately short-lived, scoped
to the app folder, and held only in `sessionStorage`, but—as with any browser-held token—it remains
readable by JavaScript running in the same origin, so a strict CSP is part of the XSS defense.

In the optional container path, the VM only pulls images from GHCR. A merge/push alone does **not**
deploy production; the workflow must be dispatched deliberately.

> **Token note:** pushing workflow files requires the GitHub token to have the `workflow` scope. The
> current `gh` token has `repo` but not `workflow` — run `gh auth refresh -h github.com -s workflow`
> once before the first push that includes `.github/workflows/`.

## 4. Optional container-path setup

1. Install Docker Engine + compose plugin.
2. Create a limited **deploy user** + install the deploy public key in its `authorized_keys`.
3. Place `deploy/docker-compose.yml`; the container binds `127.0.0.1:PORT` with `restart: always`.
4. Point the existing Cloudflare Tunnel ingress at the loopback port. `deploy/Caddyfile.snippet` is a
   historical/alternative proxy example, not the live Bible route.
5. **Cloudflare:** respect origin `Cache-Control`; do not add a hostname-wide "Cache Everything" rule.
6. Add GitHub repo secrets: `SSH_DEPLOY_KEY`, `VM_HOST` (and `VM_USER`, `DEPLOY_DIR` if not defaulted).

After this, dispatching `publish-image.yml` **with `deploy_to_vm` ticked** drives the optional
container rollout; a plain dispatch only publishes the image, and commits never auto-deploy.

## 5. Edge / caching / uptime

- **Cloudflare/browser policy:** never store `index.html`; cache fingerprinted `/assets/*` for one year
  as immutable; revalidate unhashed files and API JSON. Cloudflare respects these origin headers and
  must not apply a hostname-wide "Cache Everything" rule. This makes deployments visible immediately
  without giving up efficient caching of the large bundles.
- **Uptime:** container `restart: always`; UptimeRobot is the sole external monitor and must hit
  `/ready` so a missing, invalid, or schema-outdated database is detected.
- Logs go to stdout without secrets or personal data.

## 6. Scaling / switching path

1. **Free lever:** Cloudflare caching — most requests never reach origin.
2. **More capacity:** run multiple replicas behind the tunnel/proxy (read-only SQLite is safe to
   replicate).
3. **Off the VM:** push image to GHCR → deploy on Fly.io / Render / bigger VM → repoint DNS. Content =
   one file that travels with the image. **No data migration** (server holds no mutable state).
4. **Future first-party accounts / shared notes:** introduce a writable DB (Postgres) + managed host.
   Personal cross-browser notes remain direct browser-to-Dropbox and do not make this server stateful.

Capacity verification is two-layered: pytest catches simultaneous-connection regressions against the
fixture DB, while `scripts/load-smoke.py --concurrency 100 --requests 1000 ...` is the repeatable
host/runtime smoke. Record its error rate and p95 rather than treating the architecture alone as a
measured 100-client guarantee. A 2026-07-24 local one-Uvicorn run completed 1,000 requests at
concurrency 100 with 0 errors and p95 229.0 ms (479.3 requests/s); production VM results remain a
separate post-deploy measurement.

## 7. Content update flow

`content.sqlite` is a **build artifact**, not committed. Public-domain **sources** live in
`data/sources/` (committed); the Docker build's `content` stage runs `bibleimport` to regenerate the DB
reproducibly. In the container path, a content change = update source/importer → commit → manually
dispatch `publish-image.yml` with `deploy_to_vm` ticked → image/DB rebuild and rollout. Native production follows the atomic build/swap
procedure in the live runbook. Reverting/redeploying the prior release is rollback. (No Git LFS — the
DB never enters git.)

## 8. Native production path

The current live path uses a virtualenv, Gunicorn systemd unit (`Restart=always`), FastAPI-served
versioned SPA files, and `content.sqlite` on disk. Cloudflare Tunnel targets the loopback service.
The generic release/rollback commands live in
[`docs/deployment/backups-and-rollback.md`](../../docs/deployment/backups-and-rollback.md); the
operator-specific invocation stays in the private runbook.
