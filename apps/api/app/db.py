"""Read-only SQLite access. One connection per request (cheap for an immutable file)."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import TypedDict

from . import settings

# Keep this in sync with bibleimport.schema.SCHEMA_VERSION. It is intentionally duplicated because
# the production API package does not depend on the offline importer package.
CONTENT_SCHEMA_VERSION = 3


class DatabaseStatus(TypedDict):
    status: str
    content_version: str | None
    schema_version: int | None
    expected_schema_version: int


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = path or settings.CONTENT_DB_PATH
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_conn() -> Iterator[sqlite3.Connection]:
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def database_status(path: Path | None = None) -> DatabaseStatus:
    """Inspect content availability and compatibility without relying on application queries."""
    try:
        conn = connect(path)
    except sqlite3.OperationalError:
        return {
            "status": "no-content",
            "content_version": None,
            "schema_version": None,
            "expected_schema_version": CONTENT_SCHEMA_VERSION,
        }
    schema_version: int | None = None
    try:
        schema_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if schema_version != CONTENT_SCHEMA_VERSION:
            return {
                "status": "schema-outdated",
                "content_version": None,
                "schema_version": schema_version,
                "expected_schema_version": CONTENT_SCHEMA_VERSION,
            }
        rows = conn.execute("SELECT id, checksum FROM works ORDER BY id").fetchall()
    except sqlite3.OperationalError:
        return {
            "status": "invalid-content",
            "content_version": None,
            "schema_version": schema_version,
            "expected_schema_version": CONTENT_SCHEMA_VERSION,
        }
    finally:
        conn.close()
    if not rows:
        return {
            "status": "no-content",
            "content_version": None,
            "schema_version": schema_version,
            "expected_schema_version": CONTENT_SCHEMA_VERSION,
        }
    import hashlib

    h = hashlib.md5()
    for r in rows:
        h.update(f"{r['id']}:{r['checksum']};".encode())
    return {
        "status": "ready",
        "content_version": h.hexdigest()[:16],
        "schema_version": schema_version,
        "expected_schema_version": CONTENT_SCHEMA_VERSION,
    }


def content_version(path: Path | None = None) -> str | None:
    """A short cache version for a compatible content DB; None otherwise."""
    return database_status(path)["content_version"]
