# bible_app_bg

Bilingual, multi-pane Bible reading web app served at **bible.trendafilovi.net**.

- 1–3 resizable panes; each pane can be a Bible, commentary, dictionary, or notes.
- English (public-domain) Bible, a commentary, a dictionary, and cross-references. A Bulgarian Bible is
  deferred until rights are cleared (see [`plan/content_and_licensing.md`](plan/content_and_licensing.md)).
- Verse-per-line or continuous layout; words of Christ off / bold / red.
- Bilingual interface (EN/BG). Local (browser-side) personal notes. Full-text search.

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
- **M3** — Matthew Henry commentary + Easton's dictionary panes, and TSK-derived cross-references
  with WEB verse previews. ✅
- **M4** — local personal notes + search refinements. ⏳ next.

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
