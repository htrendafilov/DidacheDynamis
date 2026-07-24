# apps/importer

`bibleimport` CLI — the **only** writer of `content.sqlite`. Parses Bible source texts into the
canonical representation (CIR), validates versification, builds FTS rows, and writes the read-only
database the API serves. Runs offline, never in the request path.

See [`../../plan/backend/backend_design.md`](../../plan/backend/backend_design.md) §2–6.

## Status (M7.2 + review hardening)
- Schema + FTS5 (`schema.py`), canonical book table (`books.py`), CIR (`canonical.py`).
- **USFX adapter** (`formats/usfx.py`) — handles words-of-Jesus (`<wj>`), poetry (`<q>`), Psalm titles
  (`<d>`), paragraph structure; skips footnotes/cross-refs.
- Checksum-bound expected versification deltas; undeclared alignment differences block before write.
- Bounded compressed/expanded inputs, safe XML parsing, structured audit lines, and atomic JSON
  diagnostics reports.
- Imports the **World English Bible** (66 books, ~31,098 verses).
- Imports hierarchical SWORD General Books into Document CIR; the public-domain 1689 Baptist
  Confession is the first production module.

## Usage

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"

# Import the WEB (from data/sources/)
bibleimport build-web --source ../../data/sources/engwebp_usfx.zip --out ../../data/content.sqlite

# Generic form (any USFX Bible + explicit metadata)
bibleimport build --format usfx --work-id web --title "World English Bible" --abbrev WEB \
  --language en --versification kjv --license "Public Domain" --attribution "..." \
  --source <path> --out ../../data/content.sqlite

# Rebuild the complete production content set, including General Books
bibleimport build-all --sources-dir ../../data/sources --out ../../data/content.sqlite
# Report: ../../data/content.sqlite.diagnostics.json (or pass --report <path>)

# Tests
pytest -q
```

The study adapter imports a raw-OSIS SWORD `mod2imp` export for Matthew Henry (preserving headings,
paragraphs, quotations, verse numbers, and emphasis), a stripped Easton's export, CCEL ThML, and
TSK-derived TSV cross-references. The Bible adapters import WEB USFX and CrossWire KJV raw-OSIS IMP.
The General Book adapter turns slash-keyed `mod2imp` exports into a hierarchical section tree while
reusing the study Document CIR.
The production sources and provenance are documented in
[`../../data/sources/README.md`](../../data/sources/README.md). The Bulgarian source remains deferred
until rights clear. Adding a format = a new file in `formats/` + fixtures; no change to the passage
API or reader.
