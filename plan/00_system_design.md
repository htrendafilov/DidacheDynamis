# Bible Reader — System Design (v1)

`bible.trendafilovi.net` — a bilingual, multi-pane Bible reading web app.

> This folder is the **monorepo root** (GitHub: `htrendafilov/DidacheDynamis`). See also
> [`frontend/frontend_design.md`](frontend/frontend_design.md),
> [`backend/backend_design.md`](backend/backend_design.md),
> [`deployment/deployment_design.md`](deployment/deployment_design.md).
> These documents are the authoritative v1 product and technical design.

## 1. Product shape

A responsive SPA. Desktop shows **1–3 resizable panes**; mobile collapses to a single pane with a
source switcher. Each pane is bound to a **source**:

- **Bible pane** — selectable WEB or KJV English text with a book/chapter selector. (A Bulgarian Bible —
  is a supported source type but deferred until rights are cleared; see §7.)
- **Commentary pane** — follows a reference (book/chapter[/verse]).
- **Dictionary pane** — headword lookup + list.
- **General Book pane** — hierarchical table of contents + standalone reference/theology documents.
- **Notes pane** — free / verse-attached personal notes, stored **locally in the browser**.

Panes can be passage-synced: the global Settings toggle makes book/chapter changes update every open
Bible/commentary pane. Exact scroll position and verse highlighting are not synchronized.

### Reading options (global, persisted client-side)
- **Verse layout:** `per-line` (each verse on its own line) vs `flowing` (continuous paragraph text
  with inline superscript verse numbers) — same content, two render modes.
- **Words of Christ:** `off` / `bold` / `red`.
- Font size, light/dark theme, interface language (EN/BG).

## 2. Requirements → decisions

| Requirement | Decision |
|---|---|
| 1/2/3 panes, any pane = bible/commentary/dictionary/book/notes | `react-resizable-panels`, source-bound panes |
| EN Bibles, 1 BG Bible, 1 commentary | WEB + CrossWire KJV 3.1 + Matthew Henry. **BG deferred** — no rights-clear Bulgarian text yet (see [`content_and_licensing.md`](content_and_licensing.md)) |
| + dictionary + cross-references (clarified in scope) | Easton's (PD) + Treasury of Scripture Knowledge (PD) |
| verse-per-line vs continuous | render mode over one canonical representation |
| words of Christ bold/red | `wordsOfJesus` node flag toggled by CSS class |
| served at bible.trendafilovi.net behind Cloudflare | Cloudflare Tunnel → native VM service on loopback |
| EN/BG interface | `react-i18next`; Bulgarian default; canonical book names follow UI language |
| cheap + good uptime | existing VM + Cloudflare Tunnel; portable Docker/GHCR path remains available |
| editable notes | client-side IndexedDB; optional direct Dropbox App Folder sync, no app accounts |
| full-text search | SQLite FTS5 |

## 3. Key architectural decision: stateless read-only server

Notes are owned by the browser (IndexedDB), with optional direct browser-to-Dropbox App Folder sync,
and content is imported **rarely by the owner**. So the production server owns **no mutable state** —
it serves a **read-only SQLite database** built offline by a CLI importer. Consequences:

1. Avoids server-side write contention. Simultaneous-read integration tests and the repeatable
   100-client load smoke verify a particular build/host; capacity is measured rather than assumed.
2. "Switch hosts" = copy one `.sqlite` file + repoint DNS — no data migration.
3. **No admin UI, app accounts, or server sessions** in v1. Dropbox PKCE OAuth runs entirely in the
   browser and its token never reaches the production server.

The future trigger to revisit this is **first-party accounts / server-owned note sharing**, which is
where a writable DB (Postgres) + managed host would be introduced.

## 4. Canonical addressing (why EN and BG align)

Every verse has a stable reference: **OSIS book code** (`Gen`, `Ps`, `Matt`, …) + chapter + verse.
Both Bibles map to one reference space at import time, so pane-sync and cross-references work across
translations and languages.

**Known risk — versification.** Bulgarian Bibles can differ (Psalm numbering, verse splits/bridges,
deuterocanon). An appended Bible starts with no allowed differences. Expected deltas must be reviewed,
recorded in its specification, and tied to source/base checksums; they remain visible as warnings.
Every undeclared or disappearing delta blocks before write. The importer never silently renumbers.

## 5. Runtime

```
Browser (SPA + notes in IndexedDB; optional direct Dropbox App Folder sync)
   │  HTTPS
Cloudflare edge + Tunnel (immutable assets; HTML/API revalidate)
   │
Native FastAPI/Gunicorn service on 127.0.0.1:8080
   │  read-only
content.sqlite  (built offline by the bibleimport CLI)
```

## 6. Monorepo layout

```
DidacheDynamis/                  # git repo root (GitHub: htrendafilov/DidacheDynamis)
├── .github/workflows/{ci.yml,publish-image.yml}
├── apps/
│   ├── web/                     # React + Vite SPA
│   ├── api/                     # FastAPI (serves API + built SPA)
│   └── importer/                # bibleimport CLI (builds content.sqlite)
├── data/{sources/,content.sqlite}   # committed PD sources; DB is a gitignored build artifact
├── deploy/{Dockerfile,docker-compose.yml,Caddyfile.snippet}
├── plan/                        # these design docs
├── scripts/{check.sh,dev.sh}
└── AGENTS.md, README.md, .env.example, .gitignore
```

## 7. Content set

**v1 ships English-only.** See [`content_and_licensing.md`](content_and_licensing.md)
for full rights analysis.

| Slot | v1 source | License |
|---|---|---|
| English Bibles | WEB + CrossWire KJV 3.1, both red-letter capable | WEB: public domain; KJV: CrossWire general public license / GPL module |
| Commentary | Matthew Henry's Complete Commentary (CCEL) | Public domain |
| Dictionary | Easton's Bible Dictionary | Public domain |
| Cross-references | Treasury of Scripture Knowledge (TSK) | Public domain |
| General Book | Baptist Confession of Faith of 1689 (CrossWire 1.0.2) | Public domain |
| Bulgarian Bible | **DEFERRED** — no rights-clear source yet | see below |

**Bulgarian is deferred, not cancelled.** Neither CrossWire Bulgarian module is usable by a custom web
app (BulVeren is copyrighted, non-commercial *SWORD-format* only; BulCarigradNT is NT-only, permission
granted to CrossWire only), and there is no public-domain Bulgarian module on CrossWire. The
public-domain path is the 1871 Tsarigrad full Bible (sourced outside CrossWire, verified). The pane
system and canonical addressing already support a second translation, so Bulgarian drops in later with
no rework once rights are cleared. Details + decision gate: [`content_and_licensing.md`](content_and_licensing.md).

Every work records `title, abbrev, language, direction, versification, license, attribution,
source_url, source_version, checksum`; attribution is shown in the UI. KJV is selectable alongside
WEB and matches the wording embedded in the Matthew Henry edition.

## 8. Build order (milestones)

1. **M0 — Repo + pipeline + deploy path.** Monorepo, GitHub repo, CI, portable GHCR workflow, VM
   setup, and `/health`. Production deployment remains deliberately manual.
2. **M1 — Content + importer.** Schema + FTS; USFX importer; import **WEB (EN)**. Importer keeps
   the EN↔other-translation versification-alignment validation ready for when Bulgarian is added.
3. **M2 — Read a Bible.** Passage API + renderer; verse-per-line vs flowing; words-of-Christ;
   book/chapter selector; the pane system (supports 1–3 panes though v1 has one Bible); i18n (EN/BG
   **interface**) + localized book names.
4. **M3 — Commentary + dictionary + xrefs.** Import Matthew Henry / Easton's / TSK; panes; verse popover.
5. **M4 — Notes + search.** IndexedDB notes (free + verse-attached) + export/import; FTS search panel.
6. **M5 — Hardening.** Cache tuning, Playwright smoke, mobile, accessibility, attribution, uptime,
   backup/rollback rehearsal → public beta.
7. **M6 — General Books.** Hierarchical SWORD General Book adapter + book API/TOC pane; ship the
   public-domain 1689 Baptist Confession first. Follow with section deep links and book search.
8. **M7 — Search.** M7.1/M7.2 delivered cross-content providers, scopes, complete pagination, and
   canonical/relevance ordering in the overlay. M7.3/M7.4 retain the workspace, exact-verse marker,
   refinement, and local history. See [`search_workspace.md`](search_workspace.md).
9. **M8 — Strong's.** After source/licensing approval, preserve lexical annotations during import
   and add structured Strong-number/lemma search through the M7 provider interface. See
   [`search_workspace.md`](search_workspace.md#10-m8-strongs-ready-design).
10. **Later — Bulgarian Bible.** Once rights are cleared (see
   [`content_and_licensing.md`](content_and_licensing.md)), import the chosen BG text. No architectural
   change — it drops into the existing pane/addressing system.

## 9. v1 non-goals

User accounts / server-side sync; audio; AI explanations; native apps; in-browser admin/import UI;
end-user uploads; multiple BG translations at once; Postgres/Redis/queues; SWORD binary
parsing. These are future triggers, not v1 work.
