# Bible Reader — System Design (v1)

`bible.trendafilovi.net` — a bilingual, multi-pane Bible reading web app.

> This folder is the **monorepo root** (GitHub: `htrendafilov/bible_app_bg`). See also
> [`frontend/frontend_design.md`](frontend/frontend_design.md),
> [`backend/backend_design.md`](backend/backend_design.md),
> [`deployment/deployment_design.md`](deployment/deployment_design.md).
> The earlier `bible_reading_software_plan.md` is a process/workflow playbook; this set of
> documents is the actual v1 product/technical design.

## 1. Product shape

A responsive SPA. Desktop shows **1–3 resizable panes**; mobile collapses to a single pane with a
source switcher. Each pane is bound to a **source**:

- **Bible pane** — English (public-domain) or Bulgarian (user-provided), with a book/chapter selector.
- **Commentary pane** — follows a reference (book/chapter[/verse]).
- **Dictionary pane** — headword lookup + list.
- **Notes pane** — free / verse-attached personal notes, stored **locally in the browser**.

Panes can be **verse-synced**: changing the passage in one Bible pane scrolls a linked
commentary / second-Bible pane to the same verse. A per-session toggle controls sync.

### Reading options (global, persisted client-side)
- **Verse layout:** `per-line` (each verse on its own line) vs `flowing` (continuous paragraph text
  with inline superscript verse numbers) — same content, two render modes.
- **Words of Christ:** `off` / `bold` / `red`.
- Font size, light/dark theme, interface language (EN/BG).

## 2. Requirements → decisions

| Requirement | Decision |
|---|---|
| 1/2/3 panes, any pane = bible/commentary/dictionary/notes | `react-resizable-panels`, source-bound panes |
| 1 EN Bible, 1 BG Bible, 1 commentary | WEB (EN, PD) + user BG file + Matthew Henry (PD) |
| + dictionary + cross-references (clarified in scope) | Easton's (PD) + Treasury of Scripture Knowledge (PD) |
| verse-per-line vs continuous | render mode over one canonical representation |
| words of Christ bold/red | `wordsOfJesus` node flag toggled by CSS class |
| served at bible.trendafilovi.net behind Cloudflare | Caddy vhost → container; Cloudflare orange-cloud |
| EN/BG interface | `react-i18next`; book names localized per work |
| cheap + good uptime | self-host on existing idle VM; Cloudflare caching |
| editable notes | client-side only (IndexedDB), no accounts in v1 |
| full-text search | SQLite FTS5 |

## 3. Key architectural decision: stateless read-only server

Notes are **client-side only** and content is imported **rarely by the owner**. So the production
server owns **no mutable state** — it serves a **read-only SQLite database** built offline by a CLI
importer. Consequences:

1. Trivially handles **≥100 concurrent** readers (SQLite WAL read path + Cloudflare caching).
2. "Switch hosts" = copy one `.sqlite` file + repoint DNS — no data migration.
3. **No admin UI, no OAuth, no server sessions** in v1 (removed vs. the old plan doc).

The future trigger to revisit this is **cloud-synced notes / accounts**, which is where a writable DB
(Postgres) + managed host would be introduced.

## 4. Canonical addressing (why EN and BG align)

Every verse has a stable reference: **OSIS book code** (`Gen`, `Ps`, `Matt`, …) + chapter + verse.
Both Bibles map to one reference space at import time, so pane-sync and cross-references work across
translations and languages.

**Known risk — versification.** Bulgarian Bibles can differ (Psalm numbering, verse splits/bridges,
deuterocanon). The importer **validates alignment** against the English reference and **reports**
mismatches; it never silently renumbers. v1 assumes the supplied BG text maps to KJV-style
versification and emits a diff report for owner review.

## 5. Runtime

```
Browser (SPA + local notes in IndexedDB)
   │  HTTPS
Cloudflare (CDN + cache: static assets + immutable GET /api responses)
   │
Caddy (bible.trendafilovi.net → 127.0.0.1:PORT)
   │
Docker container: FastAPI (Gunicorn/Uvicorn) + built SPA
   │  read-only
content.sqlite  (built offline by the bibleimport CLI)
```

## 6. Monorepo layout

```
bible_app_bg/                    # git repo root (GitHub: htrendafilov/bible_app_bg)
├── .github/workflows/{ci.yml,deploy.yml}
├── apps/
│   ├── web/                     # React + Vite SPA
│   ├── api/                     # FastAPI (serves API + built SPA)
│   └── importer/                # bibleimport CLI (builds content.sqlite)
├── data/{sources/,content.sqlite}   # sources + built artifact (LFS/release asset)
├── deploy/{Dockerfile,docker-compose.yml,Caddyfile.snippet}
├── plan/                        # these design docs
├── scripts/{check.sh,dev.sh}
└── AGENTS.md, README.md, .env.example, .gitignore
```

## 7. Content set

| Slot | v1 source | License |
|---|---|---|
| English Bible | World English Bible (WEB), red-letter capable | Public domain |
| Bulgarian Bible | user-provided file (OSIS/USFM/VPL/text) | per user (attested) |
| Commentary | Matthew Henry's Complete Commentary (CCEL) | Public domain |
| Dictionary | Easton's Bible Dictionary | Public domain |
| Cross-references | Treasury of Scripture Knowledge (TSK) | Public domain |

Every work records `title, abbrev, language, direction, versification, license, attribution,
source_url, source_version, checksum`; attribution is shown in the UI. If the BG file lacks
words-of-Jesus markup, the red-letter toggle simply renders plain text for that pane (documented
limitation). KJV is the fallback English if red-letter WEB proves fiddly.

## 8. Build order (milestones)

1. **M0 — Repo + pipeline + deploy path.** Monorepo, GitHub repo, `ci.yml` + `deploy.yml`, GHCR
   image, one-off VM setup, `/health` + empty SPA auto-deploying from `main`.
2. **M1 — Content + importer.** Schema + FTS; OSIS/USFM importer; import WEB + BG; versification report.
3. **M2 — Read one/two Bibles.** Passage API + renderer; verse-per-line vs flowing; words-of-Christ;
   selectors; two synced Bible panes; i18n + localized book names.
4. **M3 — Commentary + dictionary + xrefs.** Import Matthew Henry / Easton's / TSK; panes; verse popover.
5. **M4 — Notes + search.** IndexedDB notes (free + verse-attached) + export/import; FTS search panel.
6. **M5 — Hardening.** Cache tuning, Playwright smoke, mobile, accessibility, attribution, uptime,
   backup/rollback rehearsal → public beta.

## 9. v1 non-goals

User accounts / server-side sync; audio; AI explanations; native apps; in-browser admin/import UI;
end-user uploads; multiple EN or multiple BG translations at once; Postgres/Redis/queues; SWORD binary
parsing. These are future triggers, not v1 work.
