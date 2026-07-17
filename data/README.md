# data/

- `sources/` — source texts used by the importer (gitignored; keep licensing/attribution notes here).
  Only redistributable/public-domain sources belong in git; owner-provided texts stay local.
- `content.sqlite` — the built, read-only database the API serves. Produced by `bibleimport`.
  Tracked via **Git LFS** once it first exists (added in M1); it is a build artifact, never hand-edited.
