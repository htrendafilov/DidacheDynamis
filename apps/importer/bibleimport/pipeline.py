"""Build orchestration: parse a source -> validate -> write content.sqlite (+ FTS)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .canonical import BookMeta, HeadingRow, VerseRow, WorkMeta
from .formats import usfx
from .schema import create_schema
from .validation import Diagnostics, validate


@dataclass
class BibleSpec:
    work_id: str
    title: str
    abbrev: str
    language: str
    versification: str
    license: str
    attribution: str
    source_url: str | None = None
    source_version: str | None = None
    direction: str = "ltr"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_work(
    conn: sqlite3.Connection,
    meta: WorkMeta,
    books: list[BookMeta],
    verses: list[VerseRow],
    headings: list[HeadingRow],
) -> None:
    conn.execute(
        "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
        "license,attribution,source_url,source_version,checksum) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        (meta.id, meta.type, meta.language, meta.title, meta.abbrev, meta.direction,
         meta.versification, meta.license, meta.attribution, meta.source_url,
         meta.source_version, meta.checksum),
    )
    conn.executemany(
        "INSERT INTO books(work_id,osis_code,name,sort_order,chapter_count) VALUES(?,?,?,?,?)",
        [(meta.id, b.osis, b.name, b.order, b.chapter_count) for b in books],
    )
    conn.executemany(
        "INSERT INTO verses(work_id,osis_code,chapter,verse,nodes_json,plain_text) "
        "VALUES(?,?,?,?,?,?)",
        [(meta.id, v.osis, v.chapter, v.verse, json.dumps(v.cir, ensure_ascii=False),
          v.plain_text) for v in verses],
    )
    conn.executemany(
        "INSERT INTO headings(work_id,osis_code,chapter,before_verse,kind,text) "
        "VALUES(?,?,?,?,?,?)",
        [(meta.id, h.osis, h.chapter, h.before_verse, h.kind, h.text) for h in headings],
    )
    conn.executemany(
        "INSERT INTO bible_fts(text,work_id,ref) VALUES(?,?,?)",
        [(v.plain_text, meta.id, f"{v.osis}.{v.chapter}.{v.verse}") for v in verses],
    )


def build_bible(
    source: str | Path,
    spec: BibleSpec,
    out_db: str | Path,
    fmt: str = "usfx",
) -> Diagnostics:
    """Parse a Bible source and (re)create the content DB with it. Returns diagnostics."""
    source = Path(source)
    out_db = Path(out_db)
    if fmt != "usfx":
        raise ValueError(f"unsupported format: {fmt} (M1 supports 'usfx')")

    books, verses, headings = usfx.load_usfx(source)
    diag = validate(books, verses, headings)
    if not diag.ok:
        return diag  # do not write a broken DB

    meta = WorkMeta(
        id=spec.work_id, type="bible", language=spec.language, title=spec.title,
        abbrev=spec.abbrev, direction=spec.direction, versification=spec.versification,
        license=spec.license, attribution=spec.attribution, source_url=spec.source_url,
        source_version=spec.source_version, checksum=_sha256(source),
    )

    out_db.parent.mkdir(parents=True, exist_ok=True)
    if out_db.exists():
        out_db.unlink()
    conn = sqlite3.connect(out_db)
    try:
        create_schema(conn)
        _write_work(conn, meta, books, verses, headings)
        conn.commit()
        conn.execute("PRAGMA optimize")
    finally:
        conn.close()
    return diag
