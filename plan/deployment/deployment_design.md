# Deployment Design (v1)

The same portable **Docker image** runs on either host below. See [`../00_system_design.md`](../00_system_design.md).

## 0. Hosting options (both supported)

| | **Render Free (Hobby)** | **Self-host VM** |
|---|---|---|
| Deploy | Native from GitHub (Render builds the Dockerfile on push) | GitHub Actions → GHCR → SSH to VM |
| Cost | $0 | $0 (existing box) |
| Ops | Zero servers | We manage Docker + Caddy |
| Cold start | **Spins down after 15 min idle**, ~1 min cold start (mitigable) | Always on |
| Resources | 512 MB RAM, **0.1 CPU** | 4 vCPU, ~6.7 GB free |
| Bandwidth | **5 GB/mo origin** (as of 2026-04-23) | unmetered (VM) |
| Persistent disk | none (ephemeral) — fine, our DB is baked read-only | full disk |

**Why the free tier actually fits us:** our architecture is stateless — a **read-only SQLite baked
into the image**, no managed DB, no persistent disk, no server-side writes. That sidesteps the free
tier's worst traps (no free-Postgres-expiry problem since we use SQLite; no persistent disk needed).

**The two real caveats and their mitigations:**
1. **Cold starts (15-min spin-down).** First visitor after idle waits ~1 min. Mitigate with a
   keep-warm ping (UptimeRobot every ~10 min) hitting `/health`. Keeping one service awake 24/7 ≈ 730
   instance-hours, under the **750 free hours/month** — so it fits *if this is the only free service in
   the workspace*.
2. **5 GB/month origin bandwidth + 0.1 CPU.** Both are absorbed by **Cloudflare** in front: static JS/CSS
   and immutable `/api/v1` GETs are cached at the edge, so origin egress and CPU stay tiny. This only
   holds with correct cache rules; if the cache-hit ratio is poor, 5 GB and 0.1 CPU get tight fast.

**Recommendation:** **start on Render Free** for the simplest GitHub-native deploy; keep the **VM as the
scale/fallback target** for when cold starts, the 5 GB cap, or 0.1 CPU become limiting (or if a sustained
100-concurrent, cache-missing load appears). Because the artifact is one Docker image, switching between
them is repoint-DNS + redeploy — no code change. Render config lives in [`../../render.yaml`](../../render.yaml).

## 1. Target VM (surveyed)

The target VM (host + SSH user are kept in the `VM_HOST` / `VM_USER` **GitHub Actions secrets**, not
committed) — Debian 13, 4 vCPU (AMD EPYC-Genoa), 7.8 GB RAM (6.7 GB free), 232 GB disk free,
load ≈ 0.0, 58-day uptime. Already runs **Caddy 2.6.2** (auto-TLS reverse proxy, admin API on :2019),
plus a node app and two python services. **No Postgres, no Docker; Python 3.13.5 present.** Plenty of
headroom for this app — it is not at risk of being overloaded.

## 2. Portable artifact

One **Docker image** (multi-stage: Vite build → SPA; importer stage **builds `content.sqlite` from the
committed public-domain sources**; FastAPI runtime with Gunicorn+Uvicorn). The DB is baked in
(immutable, re-tag per content version) but never lives in git. This is what makes moving hosts a
one-liner: push image to GHCR, deploy elsewhere, repoint DNS.

## 3. CI/CD pipeline (GitHub Actions → VM)

No manual steps on the box after first-time setup.

**`ci.yml`** (PR + push): runs `scripts/check.sh` — backend ruff + pytest, frontend lint/type-check +
Vitest + `vite build`. Required check before merge to `main`.

**`deploy.yml`** (push to `main`, after CI passes):
1. Build the image (`deploy/Dockerfile`); tag with commit SHA + `latest`.
2. Push to **GHCR** (`ghcr.io/htrendafilov/bible_app_bg`).
3. **Deploy over SSH** (`SSH_DEPLOY_KEY` + `VM_HOST` repo secrets): connect as a limited deploy user,
   `docker compose pull && docker compose up -d` in `deploy/`, then a `/health` smoke check.
4. **Rollback** = re-run the deploy with the previous SHA tag (or revert the commit).

The optional Dropbox notes feature needs the public `VITE_DROPBOX_APP_KEY` at SPA build time. Render
injects it as a Docker build argument; GHCR builds read repository secret `DROPBOX_APP_KEY`. The
app key is stored as a secret at the owner's request. The Dropbox app secret is never used. See the
setup steps in the repository README.

When M5 adds a Content Security Policy, its `connect-src` directive must include `'self'`,
`https://api.dropboxapi.com`, and `https://content.dropboxapi.com`; otherwise Dropbox OAuth token
exchange and notes upload/download will fail. The access token is deliberately short-lived, scoped
to the app folder, and held only in `sessionStorage`, but—as with any browser-held token—it remains
readable by JavaScript running in the same origin, so a strict CSP is part of the XSS defense.

The VM only ever **pulls** images from GHCR — the pipeline pushes, the box pulls. No source, secrets,
or build toolchain live on the VM.

> **Token note:** pushing workflow files requires the GitHub token to have the `workflow` scope. The
> current `gh` token has `repo` but not `workflow` — run `gh auth refresh -h github.com -s workflow`
> once before the first push that includes `.github/workflows/`.

## 4. First-time VM setup (one-off, manual, consequential — do with the owner)

1. Install Docker Engine + compose plugin.
2. Create a limited **deploy user** + install the deploy public key in its `authorized_keys`.
3. Place `deploy/docker-compose.yml`; the container binds `127.0.0.1:PORT` with `restart: always`.
4. Append the Caddy vhost (kept in-repo as `deploy/Caddyfile.snippet`) and reload Caddy:
   ```
   bible.trendafilovi.net {
       reverse_proxy 127.0.0.1:PORT
       encode zstd gzip
   }
   ```
   Cloudflare terminates TLS at the edge; Caddy uses a Cloudflare Origin CA cert or a normal cert
   (document the chosen mode).
5. **Cloudflare:** add the `bible` DNS record, **orange-cloud** it. Cache rules: cache static assets +
   immutable `/api/v1` GETs; respect origin `Cache-Control`.
6. Add GitHub repo secrets: `SSH_DEPLOY_KEY`, `VM_HOST` (and `VM_USER`, `DEPLOY_DIR` if not defaulted).

After this, everything is pipeline-driven.

## 5. Edge / caching / uptime

- **Cloudflare** absorbs most of the ≥100-concurrent load because content is immutable and cacheable.
- **Uptime:** container `restart: always`; external check (UptimeRobot free) hitting `/health`.
- Logs go to stdout without secrets or personal data.

## 6. Scaling / switching path

1. **Free lever:** Cloudflare caching — most requests never reach origin.
2. **More capacity:** run multiple container replicas behind Caddy (read-only SQLite is safe to
   share/replicate).
3. **Off the VM:** push image to GHCR → deploy on Fly.io / Render / bigger VM → repoint DNS. Content =
   one file that travels with the image. **No data migration** (server holds no mutable state).
4. **Future first-party accounts / shared notes:** introduce a writable DB (Postgres) + managed host.
   Personal cross-browser notes remain direct browser-to-Dropbox and do not make this server stateful.

## 7. Content update flow

`content.sqlite` is a **build artifact**, not committed. Public-domain **sources** live in
`data/sources/` (committed); the Docker build's `content` stage runs `bibleimport` to regenerate the DB
reproducibly. So a content change = update the source (or importer) → commit → `deploy.yml` rebuilds the
image (DB rebuilt inside) and rolls it out → new `?v=` busts caches. Reverting the commit / re-deploying
the previous SHA is the instant rollback. (No Git LFS — the DB never enters git.)

## 8. Native fallback (no Docker)

`uv`-managed venv, Gunicorn systemd unit (`Restart=always`) serving FastAPI; SPA static files served
by FastAPI or directly by Caddy; `content.sqlite` on disk; same Caddy vhost. Less portable, but zero
new runtime to install. Use only if the owner prefers not to run Docker on the VM.
