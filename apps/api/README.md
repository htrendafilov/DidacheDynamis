# apps/api

FastAPI service. Serves the JSON API (`/api/v1`) and the built SPA. Opens `content.sqlite` **read-only**.
Never writes; never parses source Bible formats (that is `apps/importer`).

See [`../../plan/backend/backend_design.md`](../../plan/backend/backend_design.md). Scaffolding added in M0.
