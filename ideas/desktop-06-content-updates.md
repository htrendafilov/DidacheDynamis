# Cross-cutting — Content DB Delivery & Updates

> **Update (2026-07-28):** the monolithic 189 MB DB is no longer the plan. The decided
> direction is a **minimal ~50–60 MB base + in-app module installer** — see
> `desktop-07-content-modularity-and-sword-installer.md`. This document stays as the
> reference for the mechanics that still apply (bundle-vs-download, `.zst` wire
> compression, versioning contract, atomic swap) — they now operate on the smaller
> base DB and on individual module artifacts.

`data/content.sqlite` is **291 MB** when fully built (M8 Strong's included; the
checked-out local file is a stale pre-M8 189 MB build — rebuild with `bibleimport
build-all`, works offline from committed sources). Measured breakdown: MHC ~118 MB,
KJV+Strong's layer ~125 MB (of which `verse_tokens` alignment + indexes ~70 MB,
lexicon dictionaries only ~3 MB), WEB ~18 MB, Easton ~12 MB, TSK ~8 MB, 1689 <1 MB.

## Option A — Bundle the DB in the installer

- Simplest runtime story: app works fully offline from first launch, no download UI.
- Installers become ~220–420 MB (Electron worst). Users re-download the whole DB on
  every app update unless the installer supports binary deltas (Tauri/electron updaters
  delta the *app*, not arbitrary data files — a bundled DB inside the bundle defeats
  delta updates).
- App Store / Flathub / Snap size limits are fine, but download UX is heavy for a Bible
  reader.

## Option B — Download on first run (recommended)

- Installer stays small (15–60 MB). On first launch the app downloads the DB from the
  existing static hosting (the same versioned `content.sqlite` artifact the release
  pipeline publishes), with:
  - **resumable chunked download** (HTTP `Range`), progress UI;
  - **checksum verification** against the importer's audit line (already computed at
    build time — `database_status()` in `apps/api/app/db.py` reads it);
  - stored in the OS app-data dir (`~/Library/Application Support/...`, `%APPDATA%`,
    `~/.local/share/...`), opened read-only.
- Mirrors how games and dictionary apps ship assets. First-run UX cost: one 189 MB
  download (a few minutes on broadband).
- Enables **content-only updates**: new WEB errata, the Bulgarian text when rights
  clear, new books — all ship as a new DB without touching the app binary. The app
  polls `version.json` (schema/content versions), downloads the new DB, verifies,
  swaps atomically, keeps the old one until verified — the desktop twin of the server's
  symlink-swap rollback.

## Option C — Hybrid: slim bundle + lazy modules

- Ship a **minimal DB** (Bible + search essentials) in the installer so first launch is
  instant-offline, and make commentary/dictionary/TSK/lexicon/books separate lazy
  modules.
- Requires the importer to emit **split databases** (it already has per-work structure;
  attach/detach or multiple files is a schema decision — non-trivial).
- Attractive long-term (Bulgarian text, Strong's, future books become optional
  downloads) but it's an importer/API change, not just packaging.

## Trimming the DB itself

Worth investigating regardless of delivery option:

- `VACUUM` + page-size tuning after build; FTS5 tables and their indexes typically
  dominate — check `bible_fts`, `commentary_fts`, `dictionary_fts`, `book_fts` sizes.
- FTS5 `prefix` indexes and `contentless`/`external content` tables can cut size
  significantly if the API query shapes allow.
- Compression on the wire is already effective (SQLite text compresses ~3–4×; a 189 MB
  DB downloads as ~50–70 MB with gzip/zstd — serving the download pre-compressed as
  `.sqlite.zst` and decompressing client-side is easy and big).

## Versioning & compatibility contract

- DB carries `PRAGMA user_version` (schema) + content version; API already exposes
  `database_status`. The desktop app should refuse to open an incompatible DB with a
  clear "update the app" / "re-download content" path.
- Keep N-1 compatibility: new app versions must open the previous DB so content updates
  never strand users.

## Recommendation

**Option B now** (small installer + resumable verified first-run download + content-only
updates), with the wire-compression trick (`content.sqlite.zst`) as a quick win.
Revisit Option C when the Bulgarian text or large new works land and a single DB stops
fitting all users.
