# data/

- `sources/` — source texts used by the importer. **Public-domain sources are committed** (see
  `sources/README.md`); owner-provided/licensed texts stay local (use a `*.private.*` name).
- `content.sqlite` — the built, read-only database the API serves. Produced by `bibleimport` from
  `sources/`. It is a **build artifact, gitignored** (rebuilt locally and in the Docker build), never
  hand-edited.
