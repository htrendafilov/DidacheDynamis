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
# Build the complete shipped content set
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
  --easton-source data/sources/Easton.imp.gz \
  --xref-source data/sources/crossreferences_kjv.tsv
bibleimport add-book --source book.imp.gz --out data/content.sqlite \
  --work-id example-book --title "Example Book" --abbrev EXB --language en \
  --license "Recorded terms" --attribution "Required attribution"
```

Run `bibleimport --help` and `bibleimport <command> --help` for the current argument contract. There
are no standalone `info` or `validate-versification` commands.

## Validation and parser safety

Bible builds check duplicate/non-positive references, empty verses, missing/extra canonical books, and
chapter gaps. `align_versification()` provides the EN↔BG comparison hook, but it is not exposed as a
CLI command yet.

XML and embedded OSIS fragments use `defusedxml`; study sources and expanded SWORD IMP streams have
explicit size caps. General Book markup is parsed through a strict allow-list. The importer does not
currently implement a general entropy check, and the USFX adapter does not yet apply a source/expanded
ZIP size ceiling; treat those as hardening follow-ups rather than existing guarantees.
