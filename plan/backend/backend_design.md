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

-- FTS5 (contentless external-content tables mirroring plain_text/body):
bible_fts(text, work_id UNINDEXED, ref UNINDEXED)
commentary_fts(text, work_id UNINDEXED, ref UNINDEXED)
dictionary_fts(text, work_id UNINDEXED, headword UNINDEXED)
book_fts(text, work_id UNINDEXED, section_id UNINDEXED)
```

Indexes on `(work_id, osis_code, chapter)` for passage/commentary lookups; on
`dictionary_entries(work_id, sort_key)` for prefix listing; on `xrefs(osis_code, chapter, verse)`.

## 3. Canonical Intermediate Representation (CIR)

`nodes_json` / `body_json` store an ordered list of typed nodes — **the source format never reaches
the client.** The importer parses OSIS/USFM/ThML; the API returns CIR; the SPA renders CIR.

- **Block nodes:** `paragraph`, `poetryLine`, `heading`, `verse`.
- **Inline nodes:** `text`, `wordsOfJesus`, `emphasis`, `divineName`, `note`, `xref`.

The first renderer must support paragraph, poetryLine, heading, verse, text, emphasis, wordsOfJesus,
divineName. The importer **reports** (not silently drops) unsupported constructs.

Example verse `nodes_json`:
```json
[{"t":"verse","n":16,"children":[
  {"t":"wordsOfJesus","children":[{"t":"text","v":"For God so loved the world…"}]}
]}]
```

## 4. API — `/api/v1`, all GET, all cacheable

```
GET /health, /ready
GET /works                                   → all works + metadata + attribution
GET /works/{id}/books                        → localized book list + chapter counts
GET /works/{id}/passage/{osis}/{chapter}     → CIR nodes for a chapter (?verse= optional)
GET /commentary/{id}/{osis}/{chapter}        → entries for a chapter (?verse= narrows)
GET /dictionary/{id}/entries?prefix=&limit=  → headword list (autocomplete)
GET /dictionary/{id}/entry/{headword}        → entry body
GET /books                                   → General Book works
GET /book/{id}                               → hierarchical TOC + Document CIR bodies
GET /xref/{osis}/{chapter}/{verse}           → cross-references (+ target preview text)
GET /search?q=&works=&lang=&limit=&offset=   → FTS5 across selected works; snippets + refs
```

- **Caching:** content is immutable per version → `Cache-Control: public, max-age=…, immutable` +
  `ETag` (derived from the DB `checksum`). The SPA appends `?v=<checksum>`; a new import busts caches.
  Cloudflare then serves the majority of reads.
- **No auth / no CSRF surface** — reading is fully public; there are no writes.
- **Search:** FTS5 `MATCH` with `bm25()` ranking and `snippet()`/`highlight()` for context. Scope by
  `works` and `lang`. Guard with `limit` caps + a query-length cap.
- **Pydantic** response models mirror the CIR node types; FastAPI's OpenAPI doc is the contract the
  frontend's `data/api.ts` types track.

## 5. Concurrency / ≥100 sessions

Read-only SQLite, **WAL** mode, opened `mode=ro&immutable=1`, one connection per worker (or a tiny
pool). Gunicorn with **N = 4–8 Uvicorn workers** on the 4-vCPU VM. No server-side write contention
exists. Combined with Cloudflare caching of immutable GETs, origin load is a small fraction of client
requests — comfortably beyond 100 concurrent.

## 6. Importer CLI (`bibleimport`)

Adapter protocol (`probe` / `analyze` / `parse`) with one adapter per source format:

```
apps/importer/
  cli.py                 # bibleimport <cmd> …
  pipeline.py            # detect → parse → validate → build FTS → write sqlite → report
  canonical.py           # CIR types + builders
  validation.py          # versification alignment, missing/dup/out-of-range refs, encoding
  formats/{osis,usfm,vpl,thml,sword}.py
```

- `osis.py`, `usfm.py` — Bibles. `study.py` — Matthew Henry + Easton's from official SWORD
  `mod2imp -s` exports (plus CCEL ThML compatibility) and TSK-derived TSV. `genbook.py` converts
  slash-keyed General Book `mod2imp` exports to the shared Document CIR. `vpl.py` — plain
  verse-per-line fallback for the BG file if needed. SWORD binaries are never parsed directly.
- **Validation** aligns EN↔BG by canonical ref and emits a diff report; publication of a misaligned
  work is blocked with an actionable message.
- **Untrusted-file safety:** size/entropy limits; XML parsed with DTD/external-entity/network
  disabled; no shell interpolation; SHA-256 checksum + one audit line per import.
- **Output:** a single `content.sqlite`, versioned by checksum, plus a diagnostics report.

## 7. Layout

```
apps/api/app/
  main.py            # FastAPI app, static SPA mount, routers, cache headers
  db.py              # read-only sqlite connection mgmt (WAL, mode=ro, per-worker)
  routers/           # health, works, passages, commentary, dictionary, xref, search
  models.py          # Pydantic CIR + response models
  settings.py        # env config (DB path, workers, cache max-age)
  pyproject.toml     # ruff, pytest, deps
```

## 8. Testing (pytest)

- Endpoint tests against a small fixture `content.sqlite` (works/passage/commentary/dictionary/xref/search).
- Importer tests with tiny OSIS/USFM/ThML fixtures, **including a deliberate versification-mismatch**
  case that must be reported and block publication.
- A read-only concurrency test issuing many parallel reads.
- `scripts/check.sh` runs ruff + pytest for the backend.
