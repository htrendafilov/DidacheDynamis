# apps/importer

`bibleimport` CLI — the **only** writer of `content.sqlite`. Parses OSIS/USFM/ThML/… into the canonical
representation (CIR), validates versification alignment, builds FTS rows, and writes the read-only
database the API serves. Runs offline, never in the request path.

See [`../../plan/backend/backend_design.md`](../../plan/backend/backend_design.md) §6. Scaffolding added in M1.
