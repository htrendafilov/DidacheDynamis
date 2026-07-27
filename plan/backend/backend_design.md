# Backend Design (v1)

FastAPI (Python 3.13) serving a **read-only** SQLite + FTS5 database, plus an offline **importer CLI**
that builds that database. See [`../00_system_design.md`](../00_system_design.md).

## 1. Two programs, one repo

- **`apps/api`** — the running web service. Read-only. Serves the JSON API and the built SPA.
- **`apps/importer`** — the `bibleimport` CLI. Parses source texts into the canonical model and writes
  `content.sqlite`. **Never runs inside the request path.** The server only reads what the importer produced.

This split is what keeps the server stateless and portable.

## 2. Database schema (built by importer, opened `mode=ro` in prod)

```sql
works(id, type, language, title, abbrev, direction, versification,
      license, attribution, source_url, source_version, checksum)
      -- type ∈ {bible, commentary, dictionary, xref, book}

books(work_id, osis_code, name, sort_order, chapter_count)   -- localized names per work

verses(work_id, osis_code, chapter, verse,
       nodes_json,     -- canonical structured content (CIR, see §3)
       plain_text,     -- normalized text for search/lookup
       PRIMARY KEY(work_id, osis_code, chapter, verse))

headings(work_id, osis_code, chapter, before_verse, text)

commentary_entries(work_id, osis_code, chapter, verse_start, verse_end, body_json)

dictionary_entries(work_id, headword, sort_key, language, body_json)

book_sections(work_id, section_id, parent_id, sort_order, level, title, body_json)

xrefs(osis_code, chapter, verse, target_ref, votes)          -- TSK; translation-independent

-- M8.1 Strong's lexical data (see ../search_workspace.md §10):
verse_tokens(work_id, osis_code, chapter, verse, position, ordinal,
             surface, normalized, strong_id, morph_scheme, morph_code,
             PRIMARY KEY(work_id, osis_code, chapter, verse, position, ordinal))
strong_lexicon(strong_id, language, lemma, transliteration, pronunciation, definition_json)

-- Ordinary FTS5 virtual tables storing indexed content directly
-- (selected locator/sort columns shown; these do not use content='' or external content):
bible_fts(text, work_id UNINDEXED, ref UNINDEXED, osis UNINDEXED,
          testament UNINDEXED, book_order UNINDEXED, chapter UNINDEXED, verse UNINDEXED)
commentary_fts(text, work_id UNINDEXED, entry_id UNINDEXED, osis UNINDEXED,
               testament UNINDEXED, book_order UNINDEXED, chapter UNINDEXED,
               verse_start UNINDEXED)
dictionary_fts(text, headword_text, work_id UNINDEXED, headword UNINDEXED,
               sort_key UNINDEXED)
book_fts(text, title_text, work_id UNINDEXED, section_id UNINDEXED,
         sort_order UNINDEXED)
```

Indexes on `(work_id, osis_code, chapter)` for passage/commentary lookups; on
`dictionary_entries(work_id, sort_key)` for prefix listing; on `xrefs(osis_code, chapter, verse)`.
`PRAGMA user_version` carries the schema version. The API checks it at startup/readiness and returns
`schema-outdated` rather than querying an incompatible local build.

## 3. Canonical Intermediate Representation (CIR)

`nodes_json` / `body_json` store normalized structures — **the source format never reaches the
client.** Bible CIR is `{"lines":[...]}`: each line records prose/poetry kind, indentation,
paragraph-start, and text runs with an optional words-of-Jesus flag. Commentary, dictionary, and
General Book Document CIR is `{"blocks":[...]}` with heading/paragraph/quotation blocks and optional
emphasis/strong/superscript/scripture-reference runs. `divineName`, source-note, and generic xref
inline nodes from the original design remain deferred.

Example Bible `nodes_json`:
```json
{"lines":[{"kind":"p","level":1,"para_start":true,
  "runs":[{"t":"For God so loved the world…","wj":true}]}]}
```

## 4. API — `/api/v1`, all GET, all cacheable

```
GET /health, /ready
GET /api/v1/meta
GET /api/v1/works
GET /api/v1/works/{id}/books
GET /api/v1/works/{id}/passage/{osis}/{chapter}?verses=16|1-19
GET /api/v1/commentary/{id}/{osis}/{chapter}?verse=
GET /api/v1/dictionary/{id}/entries?prefix=&limit=
GET /api/v1/dictionary/{id}/entry/{headword}
GET /api/v1/books
GET /api/v1/book/{id}
GET /api/v1/xref/{osis}/{chapter}/{verse}?preview_work=
GET /api/v1/search?q=&refine=&types=&works=&canon=&books=&languages=&sort=&limit=&offset=
```

- **Caching:** API responses use `ETag` plus
  `Cache-Control: public, max-age=0, must-revalidate`. Browsers therefore cannot retain an old API
  response or response shape across a deployment, while unchanged responses can still complete as
  `304 Not Modified`. Fingerprinted SPA assets, rather than API JSON, carry the long immutable TTL.
- **No auth / no CSRF surface** — reading is fully public; there are no writes.
- **Search:** provider-based FTS5 `MATCH` across Bible/commentary/dictionary/books with true counts,
  stable pagination, `bm25()` relevance or canonical/source ordering, highlighted snippets, and
  type/work/testament/book/language filters. Optional `refine` terms are safely tokenized and ANDed
  with the primary query over the complete corpus. Query/refinement/list/limit/offset values are
  capped.
- **Pydantic** response models mirror the CIR node types; FastAPI's OpenAPI doc is the contract the
  frontend's `data/api.ts` types track.

## 5. Concurrency / ≥100 sessions

The API opens SQLite with URI `mode=ro` and creates one short-lived connection per request. The
offline importer checkpoints/removes WAL state before publication; production performs no writes.
Gunicorn runs multiple Uvicorn workers on the VM. Pytest exercises simultaneous fixture-DB requests;
`scripts/load-smoke.py` is the repeatable 100-client local/VM check with explicit error-rate and p95
criteria. Record measured results before treating a particular host/runtime as capacity evidence.

## 6. Importer CLI (`bibleimport`)

```
apps/importer/
  cli.py                 # bibleimport <cmd> …
  pipeline.py            # explicit parse → validate → build FTS → write sqlite → report
  canonical.py           # CIR types + builders
  validation.py          # duplicate/non-positive refs, canon/chapter checks, alignment
  formats/{usfx,sword_bible,study,genbook}.py
```

Each adapter exposes a direct `load_*` function used by the explicit CLI/pipeline build sequence;
there is no runtime probe/analyze/plugin protocol. `usfx.py` imports WEB. `sword_bible.py`,
`study.py`, and `genbook.py` consume official `mod2imp` exports (plus study ThML compatibility and
TSK-derived TSV). SWORD binaries are never parsed directly.

- **Validation:** expected alignment deltas live in a Bible specification and are tied to reviewed
  source/base checksums. Expected differences are warnings; undeclared or disappearing differences
  are errors before the append transaction. New sources start with an empty allow-list.
- **Untrusted-file safety:** compressed/expanded byte ceilings, ZIP entry and compression-ratio
  bounds, safe XML (no DTD/external entities/network), bounded allowed markup, and no shell
  interpolation.
- **Audit/output:** each import emits a structured checksum/count/result audit line.
  `content.sqlite` plus an atomically written diagnostics JSON report are the build artifacts.

## 7. Layout

```
apps/api/app/
  main.py            # FastAPI app, static SPA mount, routers, cache headers
  db.py              # read-only sqlite connection mgmt (mode=ro, per request) + schema guard
  routers/           # health, works, passages, commentary, dictionary, general_books, xrefs, search, lexicon
  models.py          # Pydantic CIR + response models
  settings.py        # API prefix + DB and built-SPA paths from environment
  pyproject.toml     # ruff, pytest, deps
```

## 8. Testing (pytest)

- Endpoint tests against a small fixture `content.sqlite` (works/passage/commentary/dictionary/xref/search).
- Importer tests with tiny USFX/SWORD IMP/ThML/TSV fixtures, including expected and unexpected
  versification deltas, checksum binding, archive limits, and proof that a blocked append leaves the
  existing DB unchanged.
- A deterministic read-only concurrency integration test plus the separate 100-client
  `scripts/load-smoke.py` command.
- `scripts/check.sh` runs ruff + pytest for the backend.
