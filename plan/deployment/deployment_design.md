# Deployment Design (v1)

Self-host on the existing VM now, stay portable, deploy via a **CI/CD pipeline from GitHub**. See
[`../00_system_design.md`](../00_system_design.md).

## 1. Target VM (surveyed)

The target VM (host + SSH user are kept in the `VM_HOST` / `VM_USER` **GitHub Actions secrets**, not
committed) — Debian 13, 4 vCPU (AMD EPYC-Genoa), 7.8 GB RAM (6.7 GB free), 232 GB disk free,
load ≈ 0.0, 58-day uptime. Already runs **Caddy 2.6.2** (auto-TLS reverse proxy, admin API on :2019),
plus a node app and two python services. **No Postgres, no Docker; Python 3.13.5 present.** Plenty of
headroom for this app — it is not at risk of being overloaded.

## 2. Portable artifact

One **Docker image** (multi-stage: Vite build → copied into the FastAPI runtime; Gunicorn+Uvicorn
entrypoint). `content.sqlite` is **baked into the image** in v1 (immutable, re-tag per content
version). This is what makes moving hosts a one-liner: push image to GHCR, deploy elsewhere, repoint
DNS.

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
4. **Future writes (accounts / cloud notes):** introduce a writable DB (Postgres) + managed host —
   an explicit future decision, not v1.

## 7. Content update flow

Run `bibleimport` → new `content.sqlite` + diagnostics → commit (**Git LFS**, added in M1 when the
binary first exists) → `deploy.yml` rebuilds the image and rolls it out → new `?v=` busts caches.
Reverting the commit / re-deploying the previous SHA is the instant rollback.

## 8. Native fallback (no Docker)

`uv`-managed venv, Gunicorn systemd unit (`Restart=always`) serving FastAPI; SPA static files served
by FastAPI or directly by Caddy; `content.sqlite` on disk; same Caddy vhost. Less portable, but zero
new runtime to install. Use only if the owner prefers not to run Docker on the VM.
