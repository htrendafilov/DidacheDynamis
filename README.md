# bible_app_bg

[![CI](https://github.com/htrendafilov/bible_app_bg/actions/workflows/ci.yml/badge.svg)](https://github.com/htrendafilov/bible_app_bg/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Bilingual, multi-pane Bible reading web app served at **bible.trendafilovi.net**.

- 1–3 resizable panes; each pane can be a Bible, commentary, dictionary, General Book, or notes.
- English (public-domain) Bible, a commentary, a dictionary, and cross-references. A Bulgarian Bible is
  deferred until rights are cleared (see [`plan/content_and_licensing.md`](plan/content_and_licensing.md)).
- Verse-per-line or continuous layout; words of Christ off / bold / red.
- Bilingual interface (Bulgarian by default, switchable to English). Browser-side personal notes with
  optional Dropbox App Folder sync. Unified full-text search across all content types.

## Design docs

The full v1 design lives in [`plan/`](plan/):

- [`plan/00_system_design.md`](plan/00_system_design.md) — system overview
- [`plan/frontend/frontend_design.md`](plan/frontend/frontend_design.md)
- [`plan/backend/backend_design.md`](plan/backend/backend_design.md)
- [`plan/deployment/deployment_design.md`](plan/deployment/deployment_design.md)
- [`plan/search_workspace.md`](plan/search_workspace.md) — M7 Search Workspace and M8 Strong's plan
- [`plan/interactive_chat_plan.md`](plan/interactive_chat_plan.md) — M9 study-assistant plan

## Documentation

Comprehensive project documentation is available in [`docs/`](docs/):

- [`docs/user/index.md`](docs/user/index.md) — User Guide (Pane management, reading modes, rich text notes, Dropbox sync)
- [`docs/developer/index.md`](docs/developer/index.md) — Developer Guide (Setup, architecture, CIR data model, web SPA, FastAPI & testing)
- [`docs/deployment/index.md`](docs/deployment/index.md) — Deployment & Operations Guide (Cloudflare Tunnel, systemd, zero-downtime releases & monitoring)
- [`docs/extra/security-and-privacy.md`](docs/extra/security-and-privacy.md) — threat model, every storage location, and what the AI assistant sends where
- [`docs/extra/content-and-licensing.md`](docs/extra/content-and-licensing.md) — per-work rights matrix

## Privacy in short

Everything personal stays in your browser. There are no user accounts and no server-side user data:
notes, assistant conversations, reading preferences, and access tokens all live in browser storage,
and the API server only serves read-only content from a SQLite database.

Two features talk to third parties, both opt-in and both direct from your browser, never via this
project's server:

- **Dropbox sync** for notes, over OAuth 2.0 PKCE;
- **the AI study assistant**, which is off unless the build enables it *and* you supply your own
  provider API key. Your question and the sources you tick go straight to your chosen provider under
  your own account and billing.

Full detail, including what is *not* encrypted, is in
[`docs/extra/security-and-privacy.md`](docs/extra/security-and-privacy.md).

## Contributing and security

- Contributions — see [`docs/developer/contributing.md`](docs/developer/contributing.md).
- Security issues — please do **not** open a public issue; follow [`SECURITY.md`](SECURITY.md).

## Monorepo layout

```
apps/web/          React + Vite SPA
apps/api/          FastAPI service (serves API + built SPA), read-only SQLite + FTS5
apps/importer/     bibleimport CLI — builds content.sqlite offline
data/              source texts + built content.sqlite artifact
deploy/            Dockerfile, docker-compose, Caddy vhost snippet
plan/              design docs
scripts/           check.sh, dev.sh, e2e-server.sh, load-smoke.py
```

## Architecture in one line

The production server holds **no mutable state**: it serves a **read-only SQLite database** built
offline by the importer. Personal notes are client-side (IndexedDB). This removes write contention
and keeps the service portable (move = copy one file + repoint DNS). A deterministic concurrency test
and `scripts/load-smoke.py` verify the read path; actual 100-client capacity is measured per host.

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
  keyboard-navigable mobile pane-tab layout, external UptimeRobot readiness monitoring,
  and a rehearsed atomic DB/SPA backup & rollback (versioned releases + symlink swap). ✅
- **M6** — General Books: hierarchical SWORD `mod2imp` adapter, read-only book API, a TOC reader pane
  (paged/scroll with scroll-spy), full-text book search, and shareable section deep links
  (`#/book/<work>/<section>`); the reviewed English and CC0 Bulgarian editions of the 1689 Baptist
  Confession are the first shipped books.
  🚧 Initial slice complete.
- **M7.1** — search correctness: grouped `/search` envelope with true totals, `has_more`, 50-result
  pages, and relevance/canonical ordering (every Bible hit reachable, no duplicates). ✅
- **M7.2** — unified cross-content search: a provider layer over Bible/commentary/dictionary/General
  Book FTS with per-type groups, tabs/counts, testament/work/source filters, weighted headword/title
  matching, and per-type result navigation. ✅
- **M7.3** — Search Workspace: a resizable docked drawer (desktop) / full-screen (mobile) that stays
  open while reading results, survives collapse, and flashes the exact verse a Bible result opens. ✅
- **M7.4** — granular book picker, mobile filter sheet + chips, server-side refinement, and local
  recent/pinned search history with complete scope restoration. ✅
- **M7.5** — keyboard/focus behavior, screen-reader search announcements, mobile Back to results,
  EN/BG string parity, full provider/filter/pagination tests, and current search/privacy docs. ✅
- **M8.1–M8.4** — licensed Strong's lexical data, word-level reader lookup, Greek/Hebrew Dictionary
  entries, structured lexical + combined Bible-text/morphology search, and complete per-entry KJV
  concordances. ✅
- **Linking & embeds** — book/passage deep links (`#/book/…`, `#/b/…`), in-app scripture reference
  pop-ups (structured `ref` runs → hover/tap passage preview), and an embeddable `embed.js` widget for
  external sites (CORS-enabled read API). ✅ (fallback auto-linkifier deferred)
- **M9.1–M9.3d** — content-level AI-use policy, browser-direct OpenRouter integration, selected
  grounded context, citation validation, local chat history, responsive chat layout, and bounded
  context/answer budgets. ✅ The feature remains build-time gated and off in production while M9.4
  topical retrieval and M9.5 hardening remain planned.
- **Next:** prepare the repository for public release (see [`plan/going_public.md`](plan/going_public.md)).

## Run it locally

```bash
# 1) build the content DB (once)
python3 -m venv apps/importer/.venv && . apps/importer/.venv/bin/activate
pip install -e "apps/importer[dev]"
bash scripts/fetch-kjv.sh  # requires the SWORD utilities (`mod2imp`), curl, and unzip
bibleimport build-all --sources-dir data/sources --out data/content.sqlite

# 2) API on :8080
python3 -m venv apps/api/.venv && . apps/api/.venv/bin/activate && pip install -e "apps/api[dev]"
uvicorn app.main:app --app-dir apps/api --port 8080

# 3) SPA dev server on :5173 (proxies /api to :8080)
cd apps/web && npm install && npm run dev
```

See the milestone list in `plan/00_system_design.md`.

After the virtual environments and `apps/web/node_modules` are installed, `./scripts/dev.sh` builds a
missing content DB and starts both servers. Set `REBUILD_CONTENT=1` to force a current-schema rebuild.

## Dropbox notes sync setup

The reader never sends notes or Dropbox tokens to its API. The browser uses Dropbox OAuth with PKCE
and reads/writes only `/notes-v1.json` inside the app's private App Folder.

1. In the [Dropbox App Console](https://www.dropbox.com/developers/apps), create a **Scoped access**
   app with **App Folder** access. Do not select Full Dropbox.
2. Enable only `files.content.read` and `files.content.write`, disable implicit grant, and register
   the exact redirect URIs (for example `https://bible.trendafilovi.net/` and
   `http://localhost:5173/`).
3. Put the public app key in `apps/web/.env.local` as `VITE_DROPBOX_APP_KEY=...` for local builds.
   For a local or third-party build, expose the same environment variable to Vite. For the GHCR
   workflow, create the repository secret `DROPBOX_APP_KEY`. The app secret is not used.

No Dropbox app secret belongs in this repository or in the browser build. Dropbox recommends OAuth
code flow with PKCE and short-lived tokens (without refresh tokens) for pure JavaScript apps, so a
browser session occasionally needs to reconnect.

## License

The code and original documentation are under the [MIT License](LICENSE). Third-party content inputs
in [`data/sources/`](data/sources/README.md), plus the KJV fetched from CrossWire during the build,
keep their own recorded terms — the MIT license does not cover them.

[`NOTICE`](NOTICE) is the authoritative attribution record: every text this project distributes,
its rights holder, its license, the attribution it requires, and what was modified. It covers the
built artifacts as well as the repository — `content.sqlite` and the container image carry texts
that are not committed here. Full license texts are in [`LICENSES/`](LICENSES/README.md).
