# Plan: General Books support (+ 1689 Baptist Confession)

**Status:** in progress (M6; initial end-to-end slice implemented). **Goal:** add a new work type for standalone theological/reference
*books* (CrossWire "GenBook" modules), and ship the **1689 Baptist Confession of Faith** as the first.

## Source (researched 2026-07-21)
- CrossWire module **`BaptistConfession1689`**, type **RawGenBook**, **Public Domain** (v1.0.2, 2020;
  "obtained from reformed.org … with thanks to Ed Walsh"). No licensing friction — safe to bundle and
  redistribute, including in a future public repo (unlike KJV).
- The importer uses a reproducible project revision, `BaptistConfession1689-ed1.imp.gz`, which
  corrects documented omissions, proof-reference/OSIS errors, and markup defects against the
  historical 1677 text. The unaltered CrossWire export remains committed as its provenance base;
  the complete correction list and checksums live in
  `data/sources/BaptistConfession1689-ed1.info.json`.
- The release also imports `BaptistConfession1689_BG.imp.gz` as the separate `baptist1689bg` work.
  Its Bulgarian translation and editorial changes are CC0 1.0 Universal; the rights declaration,
  source chain, checksums, and complete correction record are committed beside the source.
- The actual official `mod2imp` export was verified during implementation: it contains 35 top-level
  keys (`/Content`, `/Foreword`, `/Chapter 1` … `/Chapter 32`, `/End`). Paragraphs are markup inside
  each chapter, not child keys. The adapter nevertheless supports slash-delimited child keys for
  other hierarchical GenBook modules.

## Design (heavy reuse of existing M3 machinery)

### Work model
Add work type **`book`** to the existing set (`bible | commentary | dictionary | xref`) in
`apps/api/app/…`, `apps/importer/bibleimport/schema.py`, and the frontend `PaneSourceType`
(`apps/web/src/state/store.ts`). A book is a **hierarchical document**, not verse-keyed.

### Schema (one new table)
```sql
CREATE TABLE book_sections (
    work_id    TEXT NOT NULL REFERENCES works(id),
    section_id TEXT NOT NULL,      -- stable path id, e.g. "ch1" / "ch1.p1"
    parent_id  TEXT,               -- NULL for top-level chapters
    sort_order INTEGER NOT NULL,
    level      INTEGER NOT NULL,   -- 1 = chapter, 2 = section/paragraph …
    title      TEXT NOT NULL,
    body_json  TEXT NOT NULL,      -- reuses the Document CIR (blocks/runs)
    PRIMARY KEY (work_id, section_id)
);
CREATE INDEX idx_book_sections_tree ON book_sections(work_id, parent_id, sort_order);
-- optional FTS, same pattern as commentary_fts/dictionary_fts:
CREATE VIRTUAL TABLE book_fts USING fts5(text, work_id UNINDEXED, section_id UNINDEXED, …);
```
**Reuse:** `body_json` is the same **Document CIR** (`{blocks:[{kind, text, runs}]}`) already produced
for commentary/dictionary and rendered by `apps/web/src/render/DocumentRenderer.tsx` — no new content
model or renderer needed.

### Importer (new adapter, existing toolchain)
- Export the module with the official **`mod2imp`** (same tool already used for KJV/MHC/Easton — see
  `data/sources/README.md`): `mod2imp BaptistConfession1689 | gzip -9 > BaptistConfession1689.imp.gz`.
- `apps/importer/bibleimport/formats/genbook.py`: parse the hierarchical IMP keys into a section
  tree, converting each entry's markup to Document CIR via the existing helpers in `formats/study.py`
  (`_plain_document` / `_sword_osis_document`). Reject unsupported markup rather than dropping silently.
- New `apps/importer/bibleimport/pipeline.py::append_book(...)` (mirrors `append_study_content`):
  insert the `works` row + `book_sections` + `book_fts`, transactional.
- Wire into the CLI: `bibleimport add-book …`, and include both language editions in **`build-all`**
  + `SOURCE_FILES` (`cli.py`) so the Docker/native build stays the single source of truth.
- Commit both the unaltered PD provenance source `data/sources/BaptistConfession1689.imp.gz` and the
  active reviewed `data/sources/BaptistConfession1689-ed1.imp.gz` via **Git LFS** (matches the
  `*.gz` `.gitattributes` rule).

### API
- `GET /api/v1/books` — list `book`-type works (id, title, attribution).
- `GET /api/v1/book/{id}` — full TOC tree + section bodies in one response (the 1689 is ~40 KB, so no
  need to paginate); cacheable like every other GET (ETag + Cache-Control already handled by the
  middleware in `apps/api/app/main.py`).
- Optionally extend `/search` to include `book_fts`.

### Frontend
- New `apps/web/src/panes/BookPane.tsx` (pane type `book`): a **table-of-contents** sidebar (the
  section tree) + a content area rendering the selected section via `DocumentRenderer`. Chapter/section
  navigation; deep-linkable section id.
- Enable `book` in `apps/web/src/components/SourceSelector.tsx` (`ENABLED`) and route it in
  `apps/web/src/panes/PaneHost.tsx`.
- i18n: add `source.book` + book UI strings to `en.json`/`bg.json`. Each book work retains its own
  content language; the work selector switches between the English and Bulgarian editions.

## Effort
Medium — comparable to one M3-style slice. New code is the tree schema, the `genbook` adapter, the two
book endpoints, and the TOC pane; everything else (Document CIR, DocumentRenderer, mod2imp workflow,
FTS pattern, cache/attribution/WorkFooter) is reused.

## Verification
- Importer: unit test the genbook adapter against a small fixture IMP with a 2-level tree (chapter →
  paragraph); assert the tree shape + CIR bodies.
- API: test `/books` and `/book/1689` return the TOC + a known chapter.
- Frontend: BookPane renders the TOC and a chapter; SourceSelector exposes `book`.
- Live: rebuild `content.sqlite` with `build-all`, redeploy, and confirm both editions open with all
  32 chapters and their respective Public Domain / CC0 attribution.

## Initial slice delivered
- Schema, General Book IMP adapter, `append_book`/`add-book`/`build-all`, attributed English PD
  source, and attributed Bulgarian CC0 source.
- Cacheable `/api/v1/books` and `/api/v1/book/{id}` endpoints.
- General Book pane with hierarchical TOC, shared Document CIR rendering, source info, and EN/BG UI.
- A show/hide TOC control follows the book selector in the pane header. The persisted global Settings
  panel switches all book panes between section-by-section pages and continuous scrolling, immediately
  above Dropbox note sync. On narrow screens the TOC is an overlay and closes after section selection.

## Remaining M6 follow-ups
- ~~Add URL deep links for the selected section.~~ **Done** — the active book pane's section is
  mirrored into the URL hash (`#/book/<work>/<section>`, `state/deeplink.ts`) with `replaceState`, and
  a valid hash reopens that section on load/`hashchange`. Uses the hash (not query) so it never
  collides with the Dropbox OAuth `?code`/`?state`. The full canonical scheme for all pane types stays
  in the linking plan §1.
- ~~Extend global search/navigation to `book_fts`.~~ **Done** — `GET /api/v1/search/books` returns
  breadcrumb-titled section hits with snippets; the search panel shows a separate "Books" group and a
  hit opens the section in a book pane (reusing one, else adding/converting a pane).
- Add scripture-reference pop-ups/embeds under the separate linking plan.
