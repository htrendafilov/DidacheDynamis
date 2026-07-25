# Importer CLI (`apps/importer`)

`bibleimport` is the only writer of `content.sqlite`. Production never parses source modules.

## Supported production inputs

- WEB USFX XML/ZIP through `formats/usfx.py`.
- Raw SWORD `mod2imp` Bible exports through `formats/sword_bible.py`.
- Raw SWORD General Book exports through `formats/genbook.py`.
- CrossWire commentary/dictionary IMP exports or optional CCEL ThML through `formats/study.py`.
- CrossReferences.org TSV through `formats/study.py`.

The repository does not open installed SWORD module binaries directly. Export them with the official
SWORD tools first; provenance and exact commands are recorded in `data/sources/README.md`.

## Implemented commands

```bash
# Build the complete shipped content set. The JSON report defaults to
# data/content.sqlite.diagnostics.json; override it with --report <path>.
bibleimport build-all --sources-dir data/sources --out data/content.sqlite

# Build only WEB
bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite

# Build a custom USFX Bible with explicit metadata
bibleimport build --format usfx --source bible.xml --out data/content.sqlite \
  --work-id example --title "Example Bible" --abbrev EX --language en \
  --license "Recorded terms" --attribution "Required attribution"

# Append the shipped content types to an existing database
bibleimport add-kjv --source data/sources/KJV.imp.gz --out data/content.sqlite
bibleimport add-study --out data/content.sqlite \
  --mhc-source data/sources/MHC.imp.gz \
  --easton-source data/sources/Easton.raw.imp.gz \
  --xref-source data/sources/crossreferences_kjv.tsv
bibleimport add-book --source book.imp.gz --out data/content.sqlite \
  --work-id example-book --title "Example Book" --abbrev EXB --language en \
  --license "Recorded terms" --attribution "Required attribution"
```

The `--easton-source` accepts three shapes: the raw TEI `mod2imp` export (active; its structured
`Bible:`/`Easton:` references become scripture and internal-dictionary links), the legacy stripped
IMP, and CCEL ThML. Raw-input reference classification (linked / chapter-only / deterministically
corrected / unsupported / unreconciled / ambiguous / missing) lands in the build's diagnostics JSON
alongside the audit line, and the build fails on malformed XML, an entry-count regression from
3,963, or any unclassified reference element.

Run `bibleimport --help` and `bibleimport <command> --help` for the current argument contract. There
are no standalone `info` or `validate-versification` commands.

## Validation and parser safety

Bible builds check duplicate/non-positive references, empty verses, missing/extra canonical books, and
chapter gaps. An appended Bible starts with an empty alignment allow-list: exact alignment passes, but
any undeclared difference is fatal before a write. The shipped KJV specification records the reviewed
WEB↔KJV textual-variant verses and ties them to both source checksums. Those expected differences stay
visible as warnings and structured report data. A changed/new source must be reviewed explicitly; the
importer never silently renumbers or accepts new differences.

XML and embedded OSIS fragments use `defusedxml`; study sources and expanded SWORD IMP streams have
explicit size caps. USFX applies separate ZIP-container and expanded-XML ceilings, a ZIP entry-count
limit, declared member-size checks, and a compression-ratio limit before bounded extraction. General
Book markup is parsed through a strict allow-list. These concrete limits replace a vague entropy
threshold, which is not a reliable archive-bomb defense.

Each import emits an `AUDIT` JSON line with the work ID, source filename (never its arbitrary absolute
path), source byte count, SHA-256, imported counts, and result. Every command atomically writes a
diagnostics report on success or validation failure; reports include source version/checksum,
statistics, warnings/errors, and expected/unexpected alignment deltas.

`content.sqlite` carries `PRAGMA user_version`. After pulling a schema-changing commit, rebuild it
exactly with:

```bash
apps/importer/.venv/bin/bibleimport build-all \
  --sources-dir data/sources \
  --out data/content.sqlite
```
