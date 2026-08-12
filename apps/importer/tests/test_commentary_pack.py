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
    return commentary_body_from_json({"blocks": [{"kind": kind, "text": text}]}, strict_runs=True)


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
    provenance_id: str = "mt:pilot",
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
        "source_hash": "source-" + h[:16],
        "content_hash": h,
        "provenance_id": provenance_id,
    }


def _meta(
    *,
    source_units: int | None = None,
    quality_label: str = "machine-assisted draft",
    provenances: list[dict] | None = None,
) -> dict:
    meta: dict = {
        "type": "package_meta",
        "quality_label": quality_label,
        "provenances": provenances
        or [
            {
                "provenance_id": "mt:pilot",
                "model_canonical_slug": "google/gemini-2.5-flash",
                "run_id": "test-run",
            }
        ],
    }
    if source_units is not None:
        meta["coverage"] = {
            "John": {"source_units": source_units, "excluded_units": 0, "state": "in_progress"}
        }
    return meta


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


def test_package_requires_format_version_and_source_hash(tmp_path: Path):
    path = tmp_path / "pack.jsonl.gz"
    body = _body("Hello.")
    rec = {
        "unit_id": "mhc/John/3/1-1/01",
        "osis_code": "John",
        "chapter": 3,
        "verse_start": 1,
        "verse_end": 1,
        "body": body,
        "content_hash": _hash_body(body),
    }
    _write_package(path, [rec])
    with pytest.raises(ValueError, match="format_version"):
        commentary_pack.load_commentary_package(path)


def test_package_checksum_mismatch(tmp_path: Path):
    path = tmp_path / "pack.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    _write_package(path, [_meta(), rec])
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
    records = [
        _meta(source_units=10, quality_label="работен превод"),
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
            provenance_id="mt:pilot",
            model_canonical_slug="google/gemini-2.5-flash",
            run_id="test-run",
        ),
        out,
        expected_checksum=checksum,
    )
    assert stats["commentary_entries"] == 2
    assert stats["inserted"] == 2
    assert stats["updated"] == 0

    with sqlite3.connect(out) as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION == 5
        pairs = conn.execute(
            "SELECT work_id, entry_id, unit_id FROM commentary_entries "
            "WHERE entry_id=1 ORDER BY work_id"
        ).fetchall()
        assert {(r["work_id"], r["entry_id"]) for r in pairs} == {("mhc", 1), ("mhcbg", 1)}

        cov = conn.execute(
            "SELECT state, source_units, translated_units, excluded_units "
            "FROM commentary_coverage WHERE work_id='mhcbg' AND osis_code='John'"
        ).fetchone()
        assert cov["state"] == "in_progress"  # 2 of 10
        assert cov["source_units"] == 10
        assert cov["translated_units"] == 2

        ql = conn.execute(
            "SELECT quality_label FROM works WHERE id='mhcbg'"
        ).fetchone()[0]
        assert ql == "работен превод"

        # Re-release same units under a new release — must update, not fail.
        records2 = [
            _meta(source_units=10),
            _record(
                unit_id="mhc/John/3/intro/01",
                osis="John",
                chapter=3,
                verse_start=None,
                text="Български увод (коригиран).",
            ),
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="Коментар (коригиран).",
            ),
        ]
        pack2 = tmp_path / "John-r2.jsonl.gz"
        checksum2 = _write_package(pack2, records2)
        stats2 = append_commentary(
            pack2,
            CommentarySpec(
                work_id="mhcbg",
                title="Коментар на Матю Хенри",
                abbrev="MHC-BG",
                language="bg",
                license="CC0-1.0",
                attribution="Machine draft pilot.",
                ai_context_policy="allowed",
                release_version="0.2.0",
                provenance_id="mt:pilot",
                model_canonical_slug="google/gemini-2.5-flash",
                run_id="test-run",  # same producer metadata; only release advances
            ),
            out,
            expected_checksum=checksum2,
        )
        assert stats2["updated"] == 2
        assert stats2["inserted"] == 0
        # Conflicting provenance metadata for same id must fail (package redeclares differently).
        bad_meta = _meta(source_units=10)
        bad_meta["provenances"] = [
            {
                "provenance_id": "mt:pilot",
                "model_canonical_slug": "openai/gpt-4.1",  # conflict with stored google slug
                "run_id": "other",
            }
        ]
        pack3 = tmp_path / "John-bad.jsonl.gz"
        checksum3 = _write_package(pack3, [bad_meta, records2[1], records2[2]])
        with pytest.raises(ValueError, match="different metadata"):
            append_commentary(
                pack3,
                CommentarySpec(
                    work_id="mhcbg",
                    title="Коментар на Матю Хенри",
                    abbrev="MHC-BG",
                    language="bg",
                    license="CC0-1.0",
                    attribution="x",
                    ai_context_policy="allowed",
                    release_version="0.3.0",
                    provenance_id="mt:pilot",
                    model_canonical_slug="openai/gpt-4.1",
                    run_id="other",
                ),
                out,
                expected_checksum=checksum3,
            )


def test_manifest_checksum_covers_all_packages(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    create_schema(sqlite3.connect(out))
    with sqlite3.connect(out) as conn:
        conn.execute(
            "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
            "license,attribution,checksum,ai_context_policy) "
            "VALUES('web','bible','en','WEB','WEB','ltr','kjv','PD','a','x','allowed')"
        )
        conn.commit()

    def pack_for(osis: str, unit: str, text: str) -> tuple[Path, str]:
        p = tmp_path / f"{osis}.jsonl.gz"
        recs = [
            _meta(source_units=1, quality_label="draft"),
            _record(unit_id=unit, osis=osis, chapter=1, verse_start=1, text=text),
        ]
        recs[1]["unit_id"] = unit
        recs[1]["osis_code"] = osis
        ck = _write_package(p, recs)
        return p, ck

    def spec() -> CommentarySpec:
        return CommentarySpec(
            work_id="mhcbg",
            title="BG",
            abbrev="BG",
            language="bg",
            license="CC0-1.0",
            attribution="t",
            ai_context_policy="allowed",
            release_version="1.0",
            provenance_id="mt:pilot",
            model_canonical_slug="google/gemini-2.5-flash",
            run_id="test-run",
        )

    p1, c1 = pack_for("John", "mhc/John/1/1-1/01", "John text.")
    append_commentary(p1, spec(), out, expected_checksum=c1)
    p2, c2 = pack_for("Rom", "mhc/Rom/1/1-1/01", "Rom text.")
    stats = append_commentary(p2, spec(), out, expected_checksum=c2)
    with sqlite3.connect(out) as conn:
        pkgs = conn.execute(
            "SELECT osis_code, package_checksum FROM commentary_release_packages "
            "WHERE work_id='mhcbg' AND release_version='1.0' ORDER BY osis_code"
        ).fetchall()
        assert [p[0] for p in pkgs] == ["John", "Rom"]
        h = hashlib.sha256()
        for osis, ck in pkgs:
            h.update(osis.encode())
            h.update(b"\0")
            h.update(ck.encode())
            h.update(b"\n")
        expected = h.hexdigest()
        got = conn.execute(
            "SELECT manifest_checksum FROM commentary_releases "
            "WHERE work_id='mhcbg' AND release_version='1.0'"
        ).fetchone()[0]
        assert got == expected == stats["manifest_checksum"]


def test_schema_creates_v5_tables():
    conn = sqlite3.connect(":memory:")
    create_schema(conn)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 5
    cols = {r[1] for r in conn.execute("PRAGMA table_info(works)").fetchall()}
    assert "quality_label" in cols
