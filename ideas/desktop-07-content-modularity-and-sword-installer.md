# Proposition 7 — Minimal Base Content + In-App SWORD Module Installer

Ship the desktop app with a **minimal base database** and let users install additional
content modules from inside the app. This supersedes the "ship one 189 MB DB" assumption
in `desktop-06-content-updates.md`.

## Measured size reality (fresh localhost `build-all`, 2026-07-28 — 291 MB total)

First measurement was taken on the stale local `data/content.sqlite` (2026-07-26,
pre-M8 schema — no `strong_lexicon` table, so `add-strongs` fails against it with
`no such table: strong_lexicon`). A fresh offline `bibleimport build-all` from the
committed sources reproduces the deployed 291 MB DB in under a minute — **localhost
builds are fine; the local file was simply stale**. Corrected breakdown:

| Content | Size | Share |
|---|---|---|
| **Matthew Henry Commentary** (`commentary_entries` 73.6 MB + FTS ~45 MB) | **~118 MB** | ~41% |
| **KJV + Strong's layer** (see below) | **~125 MB** | ~43% |
| — `verse_tokens` (724k KJV word-alignment rows) + its 2 indexes | ~70 MB | |
| — KJV Strong's-tagged text growth in `verses` (54.8 MB total vs 23.9 pre-M8) | ~31 MB | |
| — KJV share of base text + `bible_fts` | ~21 MB | |
| — `strong_lexicon` (5,488 Greek + 8,674 Hebrew entries) | **~3 MB** | |
| WEB text + `bible_fts` share | ~18 MB | ~6% |
| Easton's dictionary + FTS | ~12 MB | ~4% |
| TSK cross-references | ~8 MB | ~3% |
| 1689 Confession | <1 MB | — |

**Implication — the user's original instinct was right:** with M8 deployed,
KJV+Strong's (~125 MB) is in fact the largest slice, slightly ahead of MHC (~118 MB).
Note the asymmetry inside Strong's: the *lexicon dictionaries* are only ~3 MB — the
bulk is the per-word alignment layer (`verse_tokens` + tagged KJV text) that powers
`StrongsPopover`/`LexiconPane`, and it is **structurally tied to the KJV work**
(all 724k `verse_tokens` rows are `work_id=kjv`). Packaging consequence: **Strong's
ships as part of the KJV module** (or as an add-on requiring KJV) — a standalone
Strong's-lexicon module has nothing to align to.

**Decision (2026-07-28):** ship **Base B — truly minimal**: WEB + Easton's + 1689
Confession + TSK xrefs ≈ **~40–45 MB installed** (~12–18 MB as `.zst` wire download).
MHC (~118 MB) and KJV+Strong's (~125 MB) are registry modules — together they are
~84% of the current monolith, so the base download drops by ~6×. Rationale: the base
app stays a fast download for every user; commentary and the Strong's study layer are
additive value for those who want them.

(Open sub-decision: TSK stays in base at ~8 MB because cross-references are a core
reading feature — demote it to a module too if base size must shrink further.)

## Why a local-import installer fits this codebase

The importer **already appends to an existing DB** — the CLI is built for exactly this:

```
bibleimport add-kjv     --source KJV.imp.gz        --out content.sqlite
bibleimport add-book    --source X.imp.gz --work-id ... --license ... --out content.sqlite
bibleimport add-study   --mhc-source ... --easton-source ... --xref-source ...
bibleimport add-strongs --greek-source ... --hebrew-source ...
bibleimport build       --format usfx --source ... --work-id ... (any USFX Bible)
```

Each append runs the full pipeline (parse → CIR → insert → per-work FTS build →
diagnostics report) against the existing file. The desktop installer is therefore
mostly **plumbing, not new import logic**.

## Architecture: curated registry + local import (recommended)

```
┌─ Static hosting (existing release infra) ────────────────┐
│ modules.json            ← module registry (see below)     │
│ modules/kjv/KJV.imp.gz(.zst)        + sha256              │
│ modules/mhc/MHC.imp.gz(.zst)        + sha256              │
│ modules/strongs/Strongs{Greek,Hebrew}.imp.gz + sha256     │
└───────────────────────────────────────────────────────────┘
            ▲ download (resumable, verified)
┌───────────┴──────────────── Desktop app ──────────────────┐
│ Module Manager UI (new pane/route)                        │
│   list → Install: download → sha256 verify → import       │
│ Embedded importer (same Python the API sidecar ships)     │
│   appends into <app-data>/content.sqlite (user-writable)  │
│ API reopens DB / re-detects works → new pane types appear │
└───────────────────────────────────────────────────────────┘
```

Flow: base `content.sqlite` is copied out of the read-only app bundle into the OS
app-data dir on first run (never mutate the shipped file). Modules append to that copy.
The API opens it read-only per request as today; after an install completes, the shell
triggers a reopen (or the next request picks up new `works` rows — verify current
caching behavior in `apps/api/app/db.py` and routers first).

### Registry format (sketch)

```json
{
  "registryVersion": 1,
  "modules": [
    {
      "id": "kjv", "type": "bible", "title": "King James Version (1769)",
      "language": "en", "versification": "kjv",
      "license": "Public Domain", "attribution": "CrossWire SWORD, KJV 3.1",
      "description": { "en": "...", "bg": "..." },
      "artifacts": [
        { "kind": "sword-imp", "url": "modules/kjv/KJV.imp.gz.zst",
          "sha256": "…", "bytes": 4200000, "importCmd": "add-kjv" }
      ],
      "minSchemaVersion": 3, "installedBytes": 20000000
    }
  ]
}
```

Every entry carries **license + attribution + source version** — the registry is the
licensing gate (AGENTS.md content rules): nothing ships without recorded rights. This
is also the natural future channel for the **Bulgarian Bible** when rights clear, and
for additional General Books / dictionaries (adapters already exist:
`formats/sword_bible.py`, `sword_dictionary.py`, `genbook.py`, `study.py`,
`strongs_lexicon.py`, `usfx.py`).

### Desktop write path — respecting the read-only boundary

The hosted server stays 100% read-only (architecture invariant). Mutability is
**desktop-local only**:

- **pywebview/Tauri shell** runs the import as a subprocess of the frozen Python
  (or in-process for pywebview), streams progress to the UI, then tells the API to
  reopen the DB.
- Suggested seam: a desktop-only `--modules-dir`/local mode, or the shell owns imports
  entirely and the API never learns about writes — it just reopens the file. Keep
  `/api/v1` read-only even on desktop; the write path lives outside the HTTP surface.
- Importer's existing security posture applies unchanged to downloaded artifacts
  (byte ceilings, no DTD/external entities, checksum + audit line). Artifacts come only
  from our curated hosting — **no arbitrary user-supplied SWORD zips in v1** (many
  CrossWire modules are redistribution-restricted or encrypted; vetting is per-module
  legal work).

### Module removal

Append-only is easy; removal is not (verses/entries + FTS rows per work, no cascade
enforcement verified). Options:

- v1: **install-only**; "remove" = reset to base (re-copy pristine DB) — acceptable if
  modules are additive value.
- v2: importer gains `remove-work <id>` (delete by `work_id` from each table + FTS
  shadow tables + `VACUUM`). Real but bounded work; test with fixtures.

## Alternatives considered

**B. Prebuilt per-module DB slices + `ATTACH`.** Download `kjv.sqlite` etc., API
attaches all slices. No import CPU on-device, instant installs. But: multi-DB query
rework in every router + search provider (FTS can't union across attached DBs
transparently), a schema-version compatibility matrix across slices, and xrefs (TSK)
that logically span works. Bigger API surgery for marginal UX gain — the local import
of a KJV-sized module is seconds.

**C. Arbitrary user SWORD modules.** Point the app at any CrossWire zip. Rejected for
v1: licensing exposure (encrypted/restricted modules), untrusted-input surface inside
the app, versification chaos (importer policy is *report*, never silently renumber —
fine, but support load lands on us). Revisit once the curated path is proven.

## Phasing & effort

1. **Module-ready importer** (small): per-module `.zst` artifacts + sizes in build-all
   output; confirm append commands rebuild per-work FTS correctly (tests exist:
   `test_pipeline.py`, `test_study.py`, …).
2. **Registry + hosting** (small): `modules.json` generated by the release workflow;
   artifacts uploaded alongside `content.sqlite` (same versioned-release discipline).
3. **Shell import plumbing** (medium): copy-base-on-first-run, download/resume/verify,
   run import with progress, API reopen. ~300–500 lines.
4. **Module Manager UI** (medium): new settings section or pane — list, descriptions
   (EN/BG via i18n), sizes, Install button, progress, installed state. Reuses existing
   design system.
5. **Later:** `remove-work`, split-DB Option C from `desktop-06` becomes unnecessary —
   this proposition *is* the split-content strategy.

## First module catalog

| Module | Installed (est.) | Wire (est., `.zst`) | Command |
|---|---|---|---|
| KJV + Strong's bundle (tagged text, verse_tokens, both lexicons) | ~125 MB | ~35–45 MB | `add-kjv` + `add-strongs` (see coupling note below) |
| MHC | ~118 MB | ~35–40 MB | `add-study --mhc-source` (or split into `add-mhc`) |
| TSK xrefs | ~8 MB | ~2–3 MB | `add-study --xref-source` (or split) |
| Strong's lexicons only (Greek + Hebrew dictionaries) | ~3 MB | <1 MB | `add-strongs` — **requires KJV module** for popovers/alignment |
| 1689 Confession BG | <1 MB | <0.5 MB | `add-book` |
| Bulgarian Bible | when rights clear | — | `build`/`build-web`-style USFX or SWORD imp |

Note `add-study` bundles MHC+Easton+TSK today — worth splitting into per-work commands
(`add-mhc`, `add-easton`, `add-tsk`) so modules are individually installable.

**KJV/Strong's coupling:** `verse_tokens` rows are keyed to the KJV work, and the
Strong's-tagged text lives in the KJV import itself. Options: (a) one "KJV + Strong's"
bundle module (simplest, ~125 MB), or (b) split into `kjv` (~55 MB) and
`strongs-alignment` (~70 MB, depends on `kjv`) so users can take plain KJV without the
alignment layer. The lexicon dictionaries (~3 MB) ride along in either case — they are
useless without an aligned Bible. Registry entries need a `dependsOn: ["kjv"]` field
if (b) is chosen.
