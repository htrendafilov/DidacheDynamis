# apps/importer

`bibleimport` CLI — the **only** writer of `content.sqlite`. Parses Bible source texts into the
canonical representation (CIR), validates versification, builds FTS rows, and writes the read-only
database the API serves. Runs offline, never in the request path.

See [`../../plan/backend/backend_design.md`](../../plan/backend/backend_design.md) §2–6.

## Status (M1)
- Schema + FTS5 (`schema.py`), canonical book table (`books.py`), CIR (`canonical.py`).
- **USFX adapter** (`formats/usfx.py`) — handles words-of-Jesus (`<wj>`), poetry (`<q>`), Psalm titles
  (`<d>`), paragraph structure; skips footnotes/cross-refs.
- Validation + EN↔BG alignment hook (`validation.py`).
- Imports the **World English Bible** (66 books, ~31,098 verses).

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

# Tests
pytest -q
```

Adapters planned next: ThML (Matthew Henry, Easton's — M3), and the Bulgarian source once rights clear
(M6). Adding a format = a new file in `formats/` + fixtures; no change to the passage API or reader.
