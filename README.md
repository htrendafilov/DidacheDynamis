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

Scaffolding stage (milestone **M0**). See the milestone list in `plan/00_system_design.md`.
