"""Read-only SQLite access. One connection per request (cheap for an immutable file)."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

from . import settings


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


def content_version(path: Path | None = None) -> str | None:
    """A short version string derived from the works' checksums; None if DB unavailable."""
    try:
        conn = connect(path)
    except sqlite3.OperationalError:
        return None
    try:
        rows = conn.execute("SELECT id, checksum FROM works ORDER BY id").fetchall()
    except sqlite3.OperationalError:
        return None
    finally:
        conn.close()
    if not rows:
        return None
    import hashlib

    h = hashlib.md5()  # noqa: S324 - not security, just a cache tag
    for r in rows:
        h.update(f"{r['id']}:{r['checksum']};".encode())
    return h.hexdigest()[:16]
