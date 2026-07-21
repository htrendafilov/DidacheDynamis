# bible_app_bg

Bilingual, multi-pane Bible reading web app served at **bible.trendafilovi.net**.

- 1–3 resizable panes; each pane can be a Bible, commentary, dictionary, or notes.
- English (public-domain) Bible, a commentary, a dictionary, and cross-references. A Bulgarian Bible is
  deferred until rights are cleared (see [`plan/content_and_licensing.md`](plan/content_and_licensing.md)).
- Verse-per-line or continuous layout; words of Christ off / bold / red.
- Bilingual interface (EN/BG). Browser-side personal notes with optional Dropbox App Folder sync.
  Full-text search.

## Design docs

The full v1 design lives in [`plan/`](plan/):

- [`plan/00_system_design.md`](plan/00_system_design.md) — system overview
- [`plan/frontend/frontend_design.md`](plan/frontend/frontend_design.md)
- [`plan/backend/backend_design.md`](plan/backend/backend_design.md)
- [`plan/deployment/deployment_design.md`](plan/deployment/deployment_design.md)

## Monorepo layout

```
apps/web/          React + Vite SPA
apps/api/          FastAPI service (serves API + built SPA), read-only SQLite + FTS5
apps/importer/     bibleimport CLI — builds content.sqlite offline
data/              source texts + built content.sqlite artifact
deploy/            Dockerfile, docker-compose, Caddy vhost snippet
plan/              design docs
scripts/           check.sh (lint+test+build), dev.sh
```

## Architecture in one line

The production server holds **no mutable state**: it serves a **read-only SQLite database** built
offline by the importer. Personal notes are client-side (IndexedDB). This makes it trivially handle
100+ concurrent readers and portable across hosts (move = copy one file + repoint DNS).

## Status

- **M0** — repo, CI/CD pipeline, deploy path. ✅
- **M1** — schema + importer + **World English Bible** imported (66 books, ~31,098 verses, red-letter,
  poetry, FTS search). ✅ (`apps/importer`)
- **M2** — reader: FastAPI passage/search API (`apps/api`) + React SPA (`apps/web`) with resizable
  panes, verse-per-line/flowing toggle, words-of-Christ off/bold/red, book/chapter nav, EN/BG
  interface, and search. ✅
- **M3** — WEB + selectable KJV, formatted Matthew Henry commentary, Easton's dictionary panes, and
  TSK-derived cross-references
  with WEB verse previews. ✅
- **M4** — local personal notes: rich-text editor (bold/headings/lists/links + inline images),
  topical notes and passage/verse-anchored notes, recoverable deletion, guarded image storage,
  PDF export (browser print), and validated JSON backup/restore with conflict copies. All
  in-browser (IndexedDB), with optional Dropbox App Folder sync and explicit conflict copies. ✅
- **M5** — hardening: **Cloudflare Tunnel** (CDN + closed origin bypass + no cert-renewal worry),
  a **Content-Security-Policy** (Dropbox-scoped), Playwright smoke + axe accessibility tests, a
  keyboard-navigable mobile pane-tab layout, external uptime monitor (GitHub Actions + UptimeRobot),
  and a rehearsed atomic DB/SPA backup & rollback (versioned releases + symlink swap). ✅
- **Next:** General Books (1689 Confession) → deep links + scripture pop-ups/embeds → open-source the repo
  (see `plan/`).

## Run it locally

```bash
# 1) build the content DB (once)
python3 -m venv apps/importer/.venv && . apps/importer/.venv/bin/activate
pip install -e apps/importer
bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite

# 2) API on :8080
python3 -m venv apps/api/.venv && . apps/api/.venv/bin/activate && pip install -e apps/api
uvicorn app.main:app --app-dir apps/api --port 8080

# 3) SPA dev server on :5173 (proxies /api to :8080)
cd apps/web && npm install && npm run dev
```

See the milestone list in `plan/00_system_design.md`.

## Dropbox notes sync setup

The reader never sends notes or Dropbox tokens to its API. The browser uses Dropbox OAuth with PKCE
and reads/writes only `/notes-v1.json` inside the app's private App Folder.

1. In the [Dropbox App Console](https://www.dropbox.com/developers/apps), create a **Scoped access**
   app with **App Folder** access. Do not select Full Dropbox.
2. Enable only `files.content.read` and `files.content.write`, disable implicit grant, and register
   the exact redirect URIs (for example `https://bible.trendafilovi.net/` and
   `http://localhost:5173/`).
3. Put the public app key in `apps/web/.env.local` as `VITE_DROPBOX_APP_KEY=...` for local builds.
   For Render, set the same environment variable and choose **Save, rebuild, and deploy**. For the
   GHCR workflow, create the repository secret `DROPBOX_APP_KEY`. The app secret is not used.

No Dropbox app secret belongs in this repository or in the browser build. Dropbox recommends OAuth
code flow with PKCE and short-lived tokens (without refresh tokens) for pure JavaScript apps, so a
browser session occasionally needs to reconnect.
