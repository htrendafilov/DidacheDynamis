"""Runtime configuration from environment (see .env.example)."""

from __future__ import annotations

import os
from pathlib import Path

API_V1 = "/api/v1"

# Default points at the repo's data/content.sqlite (apps/api/app/ -> repo root is 3 up).
_DEFAULT_DB = Path(__file__).resolve().parents[3] / "data" / "content.sqlite"

CONTENT_DB_PATH = Path(os.environ.get("CONTENT_DB_PATH", str(_DEFAULT_DB)))

# Optional built SPA directory (served in production; absent in dev where Vite serves it).
_WEB_DIST_ENV = os.environ.get("WEB_DIST_PATH")
WEB_DIST_PATH = (
    Path(_WEB_DIST_ENV) if _WEB_DIST_ENV else Path(__file__).resolve().parent.parent / "web_dist"
)
