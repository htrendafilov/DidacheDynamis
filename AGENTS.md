# AGENTS.md — repository rules for coding agents

Read this and the relevant `plan/` design doc before changing code.

## Product & architecture (summary)

Bilingual multi-pane Bible reader. **The production server is read-only** — it serves a SQLite + FTS5
database built offline by `apps/importer`. Personal notes are client-side (IndexedDB). No accounts, no
server sessions, no admin UI in v1. Full design in [`plan/`](plan/).

## Boundaries

- `apps/web` (React/TS/Vite) ← talks only to `/api/v1`, never to the DB.
- `apps/api` (FastAPI) ← reads SQLite `mode=ro`; never writes; never parses source Bible formats.
- `apps/importer` (Python CLI) ← the only writer of `content.sqlite`; parses OSIS/USFM/ThML/… into the
  canonical representation (CIR). Source formats stop at the adapter boundary.

## Conventions

- Python: ruff (format + lint), pytest, type hints. Node: ESLint + Prettier, Vitest.
- One canonical check entrypoint: `scripts/check.sh` (run before every PR; CI runs the same).
- The API contract is FastAPI's OpenAPI doc; keep `apps/web/src/data/api.ts` types in sync.
- Reuse the CIR node types; the reader renders CIR, never raw source markup.

## Content & licensing rules

- No Bible/commentary text is committed or published without a recorded license + attribution.
- Public-domain sources: WEB (EN), Matthew Henry, Easton's, TSK. Bulgarian text is owner-provided with
  attested rights.
- The importer validates versification alignment (EN↔BG) and **reports** mismatches; it never silently
  renumbers verses.

## Security

- Imported files are untrusted: size/entropy limits, XML with DTD/external-entities/network disabled,
  no shell interpolation, checksum + audit line.
- No secrets in the repo. Deployment secrets live in GitHub Actions repo secrets.

## Stop-and-ask

Stop rather than guess on: product/theology/canon decisions, licensing, or anything that would give the
server mutable state (that is a deliberate future architecture change, not a v1 patch).
