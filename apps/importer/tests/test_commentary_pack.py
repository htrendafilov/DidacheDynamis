"""M2: commentary package adapter + multi-work append_commentary."""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport.canonical import commentary_body_from_json, make_commentary_unit_id
from bibleimport.formats import commentary_pack
from bibleimport.pipeline import (
    BibleSpec,
    CommentarySpec,
    append_commentary,
    append_study_content,
    build_bible,
)
from bibleimport.schema import SCHEMA_VERSION, create_schema

FIXTURES = Path(__file__).parent / "fixtures"


def _body(text: str, kind: str = "paragraph") -> dict:
    return commentary_body_from_json({"blocks": [{"kind": kind, "text": text}]})


def _hash_body(body: dict) -> str:
    return hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _write_package(path: Path, records: list[dict]) -> str:
    raw = b"".join((json.dumps(r, ensure_ascii=False) + "\n").encode() for r in records)
    with gzip.open(path, "wb") as handle:
        handle.write(raw)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _record(
    *,
    unit_id: str,
    osis: str,
    chapter: int,
    verse_start: int | None,
    text: str,
) -> dict:
    body = _body(text)
    h = _hash_body(body)
    return {
        "format_version": 1,
        "unit_id": unit_id,
        "osis_code": osis,
        "chapter": chapter,
        "verse_start": verse_start,
        "verse_end": verse_start,
        "body": body,
        "source_hash": h,
        "content_hash": h,
    }


def test_make_unit_id_shapes():
    assert make_commentary_unit_id("mhc", "John", 3, 1, 1) == "mhc/John/3/1-1/01"
    assert make_commentary_unit_id("mhc", "John", 3, None, 1) == "mhc/John/3/intro/01"


def test_package_limits_reject_oversized_line(tmp_path: Path):
    path = tmp_path / "big.jsonl.gz"
    limits = commentary_pack.PackageLimits(max_line_bytes=64, max_compression_ratio=10_000.0)
    with gzip.open(path, "wb") as handle:
        handle.write((json.dumps({"unit_id": "mhc/John/3/1-1/01", "pad": "x" * 200}) + "\n").encode())
    with pytest.raises(ValueError, match="line exceeds"):
        commentary_pack.load_commentary_package(path, limits=limits)


def test_package_checksum_mismatch(tmp_path: Path):
    path = tmp_path / "pack.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    _write_package(path, [rec])
    with pytest.raises(ValueError, match="checksum mismatch"):
        commentary_pack.load_commentary_package(path, expected_checksum="0" * 64)


def test_two_commentary_works_coexist_with_overlapping_entry_ids(tmp_path: Path):
    """Exit gate: English MHC + synthetic BG, same entry_id space, no collision."""
    out = tmp_path / "content.sqlite"
    web = BibleSpec(
        work_id="web",
        title="World English Bible",
        abbrev="WEB",
        language="en",
        versification="kjv",
        license="Public Domain",
        attribution="WEB is public domain.",
        ai_context_policy="allowed",
    )
    assert build_bible(FIXTURES / "mini_usfx.xml", web, out, fmt="usfx").ok
    append_study_content(
        out,
        [FIXTURES / "mini_commentary_raw.imp"],
        FIXTURES / "mini_easton_raw.imp",
        FIXTURES / "mini_xrefs.tsv",
    )

    pack = tmp_path / "John.jsonl.gz"
    # Overlap entry_id 1 with mhc by being the first row of a new work.
    records = [
        _record(
            unit_id="mhc/John/3/intro/01",
            osis="John",
            chapter=3,
            verse_start=None,
            text="Български увод към глава 3.",
        ),
        _record(
            unit_id="mhc/John/3/1-1/01",
            osis="John",
            chapter=3,
            verse_start=1,
            text="Коментар на Йоан 3:1.",
        ),
    ]
    checksum = _write_package(pack, records)
    stats = append_commentary(
        pack,
        CommentarySpec(
            work_id="mhcbg",
            title="Коментар на Матю Хенри",
            abbrev="MHC-BG",
            language="bg",
            license="CC0-1.0",
            attribution="Machine draft pilot.",
            ai_context_policy="allowed",
            release_version="0.1.0-pilot",
            provenance_id="mt:pilot-gemini",
            model_canonical_slug="google/gemini-2.5-flash",
            run_id="test-run",
        ),
        out,
        expected_checksum=checksum,
    )
    assert stats["commentary_entries"] == 2

    with sqlite3.connect(out) as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 5
        # Both works have entry_id=1
        pairs = conn.execute(
            "SELECT work_id, entry_id, unit_id FROM commentary_entries "
            "WHERE entry_id=1 ORDER BY work_id"
        ).fetchall()
        assert {(r["work_id"], r["entry_id"]) for r in pairs} == {("mhc", 1), ("mhcbg", 1)}
        assert len(pairs) == 2

        mhc_n = conn.execute(
            "SELECT COUNT(*) FROM commentary_entries WHERE work_id='mhc'"
        ).fetchone()[0]
        bg_n = conn.execute(
            "SELECT COUNT(*) FROM commentary_entries WHERE work_id='mhcbg'"
        ).fetchone()[0]
        assert mhc_n >= 1
        assert bg_n == 2

        cov = conn.execute(
            "SELECT state, translated_units FROM commentary_coverage "
            "WHERE work_id='mhcbg' AND osis_code='John'"
        ).fetchone()
        assert cov["state"] == "mt_complete"
        assert cov["translated_units"] == 2

        # FTS is per-work
        bg_hits = conn.execute(
            "SELECT work_id FROM commentary_fts WHERE commentary_fts MATCH 'Български' "
            "AND work_id='mhcbg'"
        ).fetchall()
        assert len(bg_hits) == 1


def test_duplicate_unit_id_is_rejected(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    create_schema(sqlite3.connect(out))
    # Minimal works row so FK works — use append via a tiny web build is heavier; insert work.
    with sqlite3.connect(out) as conn:
        conn.execute(
            "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
            "license,attribution,checksum,ai_context_policy) "
            "VALUES('web','bible','en','WEB','WEB','ltr','kjv','PD','a','x','allowed')"
        )
        conn.commit()

    pack = tmp_path / "a.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Once.",
    )
    checksum = _write_package(pack, [rec])
    spec = CommentarySpec(
        work_id="mhcbg",
        title="BG",
        abbrev="BG",
        language="bg",
        license="CC0-1.0",
        attribution="t",
        ai_context_policy="allowed",
        release_version="0.1",
        provenance_id="p1",
    )
    append_commentary(pack, spec, out, expected_checksum=checksum)
    with pytest.raises(ValueError, match="unit_id already present"):
        append_commentary(pack, spec, out, expected_checksum=checksum)


def test_schema_creates_v5_tables():
    conn = sqlite3.connect(":memory:")
    create_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    for name in (
        "translation_provenance",
        "commentary_releases",
        "commentary_release_packages",
        "commentary_block_provenance",
        "commentary_coverage",
        "commentary_reviews",
    ):
        assert name in tables
    cols = {
        r[1]
        for r in conn.execute("PRAGMA table_info(commentary_entries)").fetchall()
    }
    assert "unit_id" in cols and "source_hash" in cols and "content_hash" in cols
    # Composite primary key
    pk = [
        r[1]
        for r in conn.execute("PRAGMA table_info(commentary_entries)").fetchall()
        if r[5] > 0
    ]
    assert pk == ["work_id", "entry_id"] or set(pk) == {"work_id", "entry_id"}
