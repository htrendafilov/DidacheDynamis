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


def _create_content_db(path: Path) -> None:
    conn = sqlite3.connect(path)
    create_schema(conn)
    conn.execute(
        "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
        "license,attribution,checksum,ai_context_policy) "
        "VALUES('web','bible','en','WEB','WEB','ltr','kjv','PD','a','x','allowed')"
    )
    conn.commit()
    conn.close()


def _commentary_spec(*, release_version: str = "1.0", attribution: str = "t") -> CommentarySpec:
    return CommentarySpec(
        work_id="mhcbg",
        title="BG",
        abbrev="BG",
        language="bg",
        license="CC0-1.0",
        attribution=attribution,
        ai_context_policy="allowed",
        release_version=release_version,
        provenance_id="mt:pilot",
        model_canonical_slug="google/gemini-2.5-flash",
        run_id="test-run",
    )


def _record(
    *,
    unit_id: str,
    osis: str,
    chapter: int,
    verse_start: int | None,
    text: str,
    provenance_id: str = "mt:pilot",
    source_hash: str | None = None,
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
        "source_hash": source_hash or hashlib.sha256(f"source:{unit_id}".encode()).hexdigest(),
        "content_hash": h,
        "qa_status": "automated_pass",
        "correction_revision": 0,
        "provenance_id": provenance_id,
    }


def _provenance(
    provenance_id: str = "mt:pilot",
    *,
    model: str = "google/gemini-2.5-flash",
    run_id: str = "test-run",
) -> dict:
    return {
        "provenance_id": provenance_id,
        "model_request_id": model,
        "model_canonical_slug": model + "-20260812",
        "model_returned": model,
        "prompt_hash": hashlib.sha256(b"test prompt").hexdigest(),
        "glossary_hash": hashlib.sha256(b"test glossary").hexdigest(),
        "settings_json": '{"temperature":0}',
        "run_id": run_id,
        "translated_at": "2026-08-12T08:00:00Z",
    }


def _meta(
    *,
    source_units: int | None = None,
    coverage_osis: str = "John",
    state: str = "in_progress",
    quality_label: str = "machine-assisted draft",
    provenances: list[dict] | None = None,
    reviews: list[dict] | None = None,
) -> dict:
    meta: dict = {
        "type": "package_meta",
        "quality_label": quality_label,
        "provenances": provenances or [_provenance()],
    }
    if source_units is not None:
        meta["coverage"] = {
            coverage_osis: {
                "source_units": source_units,
                "excluded_units": 0,
                "state": state,
            }
        }
    if reviews is not None:
        meta["reviews"] = reviews
    return meta


def test_make_unit_id_shapes():
    assert make_commentary_unit_id("mhc", "John", 3, 1, 1) == "mhc/John/3/1-1/01"
    assert make_commentary_unit_id("mhc", "John", 3, None, 1) == "mhc/John/3/intro/01"


def test_package_limits_reject_oversized_line(tmp_path: Path):
    path = tmp_path / "big.jsonl.gz"
    limits = commentary_pack.PackageLimits(max_line_bytes=64, max_compression_ratio=10_000.0)
    with gzip.open(path, "wb") as handle:
        handle.write(
            (json.dumps({"unit_id": "mhc/John/3/1-1/01", "pad": "x" * 200}) + "\n").encode()
        )
    with pytest.raises(ValueError, match="line exceeds"):
        commentary_pack.load_commentary_package(path, limits=limits)


def test_package_limit_rejects_compressed_bytes(tmp_path: Path):
    path = tmp_path / "compressed.jsonl.gz"
    _write_package(
        path,
        [
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="Hello.",
            )
        ],
    )
    limits = commentary_pack.PackageLimits(max_compressed_bytes=path.stat().st_size - 1)
    with pytest.raises(ValueError, match="compressed limit"):
        commentary_pack.load_commentary_package(path, limits=limits)


def test_package_limit_rejects_expanded_bytes_incrementally(tmp_path: Path):
    path = tmp_path / "expanded.jsonl.gz"
    _write_package(
        path,
        [
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="x" * 1_000,
            )
        ],
    )
    limits = commentary_pack.PackageLimits(
        max_expanded_bytes=128,
        max_compression_ratio=100_000.0,
        max_line_bytes=10_000,
    )
    with pytest.raises(ValueError, match="expanded limit"):
        commentary_pack.load_commentary_package(path, limits=limits)


def test_package_limit_rejects_compression_ratio(tmp_path: Path):
    path = tmp_path / "ratio.jsonl.gz"
    _write_package(
        path,
        [
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="x" * 10_000,
            )
        ],
    )
    limits = commentary_pack.PackageLimits(
        max_expanded_bytes=100_000,
        max_compression_ratio=2.0,
        max_line_bytes=100_000,
    )
    with pytest.raises(ValueError, match="compression ratio"):
        commentary_pack.load_commentary_package(path, limits=limits)


def test_package_limit_rejects_record_count(tmp_path: Path):
    path = tmp_path / "records.jsonl.gz"
    _write_package(
        path,
        [
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="One.",
            ),
            _record(
                unit_id="mhc/John/3/2-2/01",
                osis="John",
                chapter=3,
                verse_start=2,
                text="Two.",
            ),
        ],
    )
    with pytest.raises(ValueError, match="record limit"):
        commentary_pack.load_commentary_package(
            path, limits=commentary_pack.PackageLimits(max_records=1)
        )


def test_package_limit_rejects_blocks_per_record(tmp_path: Path):
    path = tmp_path / "blocks.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="One.",
    )
    rec["body"] = _body("One.")
    rec["body"]["blocks"].append({"kind": "paragraph", "text": "Two."})
    rec["content_hash"] = _hash_body(rec["body"])
    _write_package(path, [rec])
    with pytest.raises(ValueError, match="too many blocks"):
        commentary_pack.load_commentary_package(
            path, limits=commentary_pack.PackageLimits(max_blocks_per_record=1)
        )


def test_package_limit_rejects_runs_per_block(tmp_path: Path):
    path = tmp_path / "runs.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="AB",
    )
    rec["body"] = commentary_body_from_json(
        {"blocks": [{"kind": "paragraph", "text": "AB", "runs": [{"t": "A"}, {"t": "B"}]}]},
        strict_runs=True,
    )
    rec["content_hash"] = _hash_body(rec["body"])
    _write_package(path, [rec])
    with pytest.raises(ValueError, match="too many runs"):
        commentary_pack.load_commentary_package(
            path, limits=commentary_pack.PackageLimits(max_runs_per_block=1)
        )


def test_package_limit_rejects_text_bytes_per_block(tmp_path: Path):
    path = tmp_path / "text.jsonl.gz"
    _write_package(
        path,
        [
            _record(
                unit_id="mhc/John/3/1-1/01",
                osis="John",
                chapter=3,
                verse_start=1,
                text="four",
            )
        ],
    )
    with pytest.raises(ValueError, match="oversized block text"):
        commentary_pack.load_commentary_package(
            path, limits=commentary_pack.PackageLimits(max_text_bytes_per_block=3)
        )


def test_package_limit_rejects_json_nesting_depth(tmp_path: Path):
    path = tmp_path / "depth.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    rec["extra"] = {"a": {"b": {"c": {"d": True}}}}
    _write_package(path, [rec])
    with pytest.raises(ValueError, match="nesting depth"):
        commentary_pack.load_commentary_package(
            path, limits=commentary_pack.PackageLimits(max_json_depth=4)
        )


def test_decompression_bomb_is_refused_before_a_record_is_returned(tmp_path: Path):
    path = tmp_path / "bomb.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="x" * 100_000,
    )
    _write_package(path, [rec])
    limits = commentary_pack.PackageLimits(
        max_expanded_bytes=1_024,
        max_compression_ratio=100_000.0,
        max_line_bytes=200_000,
    )
    with pytest.raises(ValueError, match="expanded limit"):
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


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("qa_status", None, "qa_status is required"),
        ("qa_status", "", "qa_status is required"),
        ("correction_revision", None, "correction_revision must be"),
        ("correction_revision", -1, "correction_revision must be"),
        ("correction_revision", True, "correction_revision must be"),
    ],
)
def test_package_requires_qa_status_and_correction_revision(
    tmp_path: Path, field: str, value: object, message: str
):
    record = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    if value is None:
        record.pop(field)
    else:
        record[field] = value
    path = tmp_path / "bad-qa.jsonl.gz"
    _write_package(path, [_meta(), record])

    with pytest.raises(ValueError, match=message):
        commentary_pack.load_commentary_package(path)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("chapter", 0, "chapter must be positive"),
        ("verse_start", True, "non-int verse_start"),
        ("osis_code", "NotABook", "non-canonical osis"),
    ],
)
def test_package_rejects_invalid_coordinates(
    tmp_path: Path, field: str, value: object, message: str
):
    path = tmp_path / f"bad-{field}.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    rec[field] = value
    _write_package(path, [rec])
    with pytest.raises((TypeError, ValueError), match=message):
        commentary_pack.load_commentary_package(path)


@pytest.mark.parametrize(
    ("run", "message"),
    [
        ({"t": 7}, "t must be a string"),
        ({"t": "x", "emphasis": "false"}, "emphasis must be a boolean"),
        ({"t": "x", "ref": "not-a-ref"}, "ref is not canonical"),
        (
            {
                "t": "x",
                "ref": "John.3.16",
                "dictionary_ref": {"work_id": "easton", "entry_key": "x", "headword": "x"},
            },
            "both ref and dictionary_ref",
        ),
    ],
)
def test_package_rejects_invalid_commentary_runs(tmp_path: Path, run: dict, message: str):
    path = tmp_path / "bad-run.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="x",
    )
    rec["body"] = {"blocks": [{"kind": "paragraph", "text": "x", "runs": [run]}]}
    rec["content_hash"] = _hash_body(rec["body"])
    _write_package(path, [rec])
    with pytest.raises((TypeError, ValueError), match=message):
        commentary_pack.load_commentary_package(path)


def test_package_rejects_duplicate_unit_and_block_provenance(tmp_path: Path):
    path = tmp_path / "duplicate-unit.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    _write_package(path, [rec, rec])
    with pytest.raises(ValueError, match="duplicate unit_id"):
        commentary_pack.load_commentary_package(path)

    override = {"block_index": 0, "provenance_id": "mt:pilot"}
    rec = dict(rec)
    rec["block_provenance"] = [override, override]
    _write_package(path, [_meta(), rec])
    with pytest.raises(ValueError, match="duplicate provenance for block"):
        commentary_pack.load_commentary_package(path)


def test_package_v1_is_one_per_book_artifact(tmp_path: Path):
    path = tmp_path / "two-books.jsonl.gz"
    john = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="John.",
    )
    romans = _record(
        unit_id="mhc/Rom/1/1-1/01",
        osis="Rom",
        chapter=1,
        verse_start=1,
        text="Romans.",
    )
    _write_package(path, [john, romans])
    with pytest.raises(ValueError, match="one per-book artifact"):
        commentary_pack.load_commentary_package(path)


def test_package_refuses_empty_provenance_metadata(tmp_path: Path):
    path = tmp_path / "empty-provenance.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
    )
    meta = _meta(provenances=[{"provenance_id": "mt:pilot"}])
    _write_package(path, [meta, rec])
    with pytest.raises(ValueError, match="no producer metadata"):
        commentary_pack.load_commentary_package(path)


def test_provenance_kind_is_derived_from_metadata_not_id_prefix(tmp_path: Path):
    path = tmp_path / "provenance-kind.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
        provenance_id="src:claimed-model",
    )

    partial_machine = {
        "provenance_id": "src:claimed-model",
        "model_canonical_slug": "provider/model",
        "run_id": "machine-run",
    }
    _write_package(path, [_meta(provenances=[partial_machine]), rec])
    with pytest.raises(ValueError, match="machine provenance.*is missing"):
        commentary_pack.load_commentary_package(path)

    full_machine = _provenance("src:claimed-model")
    _write_package(path, [_meta(provenances=[full_machine]), rec])
    with pytest.raises(ValueError, match="machine provenance.*cannot use the 'src:' prefix"):
        commentary_pack.load_commentary_package(path)

    source_without_source_id = {"provenance_id": "mt:claimed-source", "run_id": "source-import"}
    rec["provenance_id"] = "mt:claimed-source"
    _write_package(path, [_meta(provenances=[source_without_source_id]), rec])
    with pytest.raises(ValueError, match="source provenance.*must use the 'src:' prefix"):
        commentary_pack.load_commentary_package(path)

    source = {"provenance_id": "src:crosswire-mhc", "run_id": "source-import"}
    rec["provenance_id"] = "src:crosswire-mhc"
    _write_package(path, [_meta(provenances=[source]), rec])
    loaded = commentary_pack.load_commentary_package(path)
    assert loaded.provenances["src:crosswire-mhc"].run_id == "source-import"


def test_append_fallback_cannot_bypass_machine_validation_with_source_id(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    path = tmp_path / "fallback.jsonl.gz"
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Hello.",
        provenance_id="src:claimed-model",
    )
    meta = {
        "type": "package_meta",
        "quality_label": "machine-assisted draft",
        "coverage": {
            "John": {"source_units": 1, "excluded_units": 0, "state": "mt_complete"}
        },
    }
    checksum = _write_package(path, [meta, rec])
    spec = CommentarySpec(
        work_id="mhcbg",
        title="BG",
        abbrev="BG",
        language="bg",
        license="CC0-1.0",
        attribution="t",
        ai_context_policy="allowed",
        release_version="1.0",
        provenance_id="src:claimed-model",
        model_canonical_slug="provider/model",
        run_id="machine-run",
    )

    with pytest.raises(ValueError, match="machine provenance.*is missing"):
        append_commentary(path, spec, out, expected_checksum=checksum)
    with sqlite3.connect(out) as conn:
        assert conn.execute("SELECT COUNT(*) FROM works WHERE id='mhcbg'").fetchone()[0] == 0


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

        ql = conn.execute("SELECT quality_label FROM works WHERE id='mhcbg'").fetchone()[0]
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
        bad_meta["provenances"] = [_provenance("mt:pilot", model="openai/gpt-4.1", run_id="other")]
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
                    attribution="Machine draft pilot.",
                    ai_context_policy="allowed",
                    release_version="0.3.0",
                    provenance_id="mt:pilot",
                    model_canonical_slug="openai/gpt-4.1",
                    run_id="other",
                ),
                out,
                expected_checksum=checksum3,
            )


def test_entry_default_and_block_provenance_round_trip(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    pack = tmp_path / "mixed.jsonl.gz"
    p1 = _provenance("mt:pilot", model="model/primary", run_id="primary-run")
    p2 = _provenance("mt:repair", model="model/repair", run_id="repair-run")
    first = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Primary.",
    )
    first["block_provenance"] = [{"block_index": 0, "provenance_id": "mt:repair"}]
    second = _record(
        unit_id="mhc/John/3/2-2/01",
        osis="John",
        chapter=3,
        verse_start=2,
        text="Repair default.",
        provenance_id="mt:repair",
    )
    checksum = _write_package(
        pack,
        [
            _meta(source_units=2, state="mt_complete", provenances=[p1, p2]),
            first,
            second,
        ],
    )
    append_commentary(pack, _commentary_spec(), out, expected_checksum=checksum)
    with sqlite3.connect(out) as conn:
        defaults = conn.execute(
            "SELECT unit_id, provenance_id FROM commentary_entries "
            "WHERE work_id='mhcbg' ORDER BY unit_id"
        ).fetchall()
        assert defaults == [
            ("mhc/John/3/1-1/01", "mt:pilot"),
            ("mhc/John/3/2-2/01", "mt:repair"),
        ]
        override = conn.execute(
            "SELECT block_index, provenance_id FROM commentary_block_provenance "
            "WHERE work_id='mhcbg' AND unit_id='mhc/John/3/1-1/01'"
        ).fetchone()
        assert override == (0, "mt:repair")


def test_first_import_requires_honest_coverage_and_imports_queued_books(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Partial.",
    )
    pack = tmp_path / "missing-coverage.jsonl.gz"
    checksum = _write_package(pack, [_meta(), rec])
    with pytest.raises(ValueError, match="coverage metadata is required"):
        append_commentary(pack, _commentary_spec(), out, expected_checksum=checksum)
    with sqlite3.connect(out) as conn:
        assert conn.execute("SELECT COUNT(*) FROM works WHERE id='mhcbg'").fetchone()[0] == 0

    false_complete = _meta(source_units=2, state="mt_complete")
    checksum = _write_package(pack, [false_complete, rec])
    with pytest.raises(ValueError, match="cannot mark .* mt_complete"):
        append_commentary(pack, _commentary_spec(), out, expected_checksum=checksum)

    meta = _meta(source_units=2)
    meta["coverage"]["Rom"] = {
        "source_units": 5,
        "excluded_units": 0,
        "state": "queued",
    }
    checksum = _write_package(pack, [meta, rec])
    append_commentary(pack, _commentary_spec(), out, expected_checksum=checksum)
    with sqlite3.connect(out) as conn:
        rows = conn.execute(
            "SELECT osis_code,state,translated_units FROM commentary_coverage "
            "WHERE work_id='mhcbg' ORDER BY osis_code"
        ).fetchall()
        assert rows == [("John", "in_progress", 1), ("Rom", "queued", 0)]
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM books WHERE work_id='mhcbg' AND osis_code='Rom'"
            ).fetchone()[0]
            == 1
        )


def test_reviews_import_correction_does_not_count_and_retranslation_invalidates(
    tmp_path: Path,
):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    unit_id = "mhc/John/3/1-1/01"
    source_hash = hashlib.sha256(b"stable English source").hexdigest()
    rec = _record(
        unit_id=unit_id,
        osis="John",
        chapter=3,
        verse_start=1,
        text="Draft one.",
        source_hash=source_hash,
    )
    correction = {
        "unit_id": unit_id,
        "content_hash": rec["content_hash"],
        "reviewed_at": "2026-08-12T08:00:00Z",
        "kind": "correction_authored",
    }
    pack = tmp_path / "review-r1.jsonl.gz"
    checksum = _write_package(
        pack,
        [_meta(source_units=1, state="mt_complete", reviews=[correction]), rec],
    )
    stats1 = append_commentary(
        pack, _commentary_spec(release_version="1.0"), out, expected_checksum=checksum
    )
    with sqlite3.connect(out) as conn:
        assert (
            conn.execute(
                "SELECT reviewed_units FROM commentary_coverage "
                "WHERE work_id='mhcbg' AND osis_code='John'"
            ).fetchone()[0]
            == 0
        )
        first_work_checksum = conn.execute(
            "SELECT checksum FROM works WHERE id='mhcbg'"
        ).fetchone()[0]
        assert first_work_checksum == stats1["work_checksum"]

    spot = {
        "unit_id": unit_id,
        "content_hash": rec["content_hash"],
        "reviewed_at": "2026-08-12T09:00:00Z",
        "kind": "spot_read",
    }
    pack2 = tmp_path / "review-r2.jsonl.gz"
    checksum2 = _write_package(
        pack2,
        [_meta(source_units=1, state="mt_complete", reviews=[spot]), rec],
    )
    append_commentary(
        pack2,
        _commentary_spec(release_version="2.0"),
        out,
        expected_checksum=checksum2,
    )
    with sqlite3.connect(out) as conn:
        assert (
            conn.execute(
                "SELECT reviewed_units FROM commentary_coverage "
                "WHERE work_id='mhcbg' AND osis_code='John'"
            ).fetchone()[0]
            == 1
        )
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM commentary_reviews WHERE work_id='mhcbg'"
            ).fetchone()[0]
            == 2
        )

    corrected = _record(
        unit_id=unit_id,
        osis="John",
        chapter=3,
        verse_start=1,
        text="Draft two.",
        source_hash=source_hash,
    )
    pack3 = tmp_path / "review-r3.jsonl.gz"
    checksum3 = _write_package(
        pack3,
        [_meta(source_units=1, state="mt_complete"), corrected],
    )
    stats3 = append_commentary(
        pack3,
        _commentary_spec(release_version="3.0"),
        out,
        expected_checksum=checksum3,
    )
    with sqlite3.connect(out) as conn:
        assert (
            conn.execute(
                "SELECT reviewed_units FROM commentary_coverage "
                "WHERE work_id='mhcbg' AND osis_code='John'"
            ).fetchone()[0]
            == 0
        )
        assert (
            conn.execute("SELECT checksum FROM works WHERE id='mhcbg'").fetchone()[0]
            == stats3["work_checksum"]
        )
        assert stats3["work_checksum"] != first_work_checksum


def test_new_release_changes_work_checksum_when_package_bytes_are_identical(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    rec = _record(
        unit_id="mhc/John/3/1-1/01",
        osis="John",
        chapter=3,
        verse_start=1,
        text="Unchanged translation.",
    )
    pack = tmp_path / "John.jsonl.gz"
    checksum = _write_package(pack, [_meta(source_units=1, state="mt_complete"), rec])

    first = append_commentary(
        pack,
        _commentary_spec(release_version="1.0"),
        out,
        expected_checksum=checksum,
    )
    second = append_commentary(
        pack,
        _commentary_spec(release_version="1.1"),
        out,
        expected_checksum=checksum,
    )

    assert first["manifest_checksum"] == second["manifest_checksum"]
    assert first["work_checksum"] != second["work_checksum"]
    with sqlite3.connect(out) as conn:
        assert (
            conn.execute("SELECT checksum FROM works WHERE id='mhcbg'").fetchone()[0]
            == second["work_checksum"]
        )
        assert (
            conn.execute(
                "SELECT release_version FROM commentary_entries "
                "WHERE work_id='mhcbg' AND unit_id=?",
                (rec["unit_id"],),
            ).fetchone()[0]
            == "1.1"
        )


def test_release_artifacts_source_hash_and_work_metadata_are_immutable(tmp_path: Path):
    out = tmp_path / "content.sqlite"
    _create_content_db(out)
    unit_id = "mhc/John/3/1-1/01"
    rec = _record(
        unit_id=unit_id,
        osis="John",
        chapter=3,
        verse_start=1,
        text="First.",
    )
    pack = tmp_path / "immutable.jsonl.gz"
    checksum = _write_package(pack, [_meta(source_units=1, state="mt_complete"), rec])
    append_commentary(pack, _commentary_spec(), out, expected_checksum=checksum)

    changed = _record(
        unit_id=unit_id,
        osis="John",
        chapter=3,
        verse_start=1,
        text="Changed under same release.",
        source_hash=rec["source_hash"],
    )
    changed_checksum = _write_package(pack, [_meta(source_units=1, state="mt_complete"), changed])
    with pytest.raises(ValueError, match="release artifacts are immutable"):
        append_commentary(pack, _commentary_spec(), out, expected_checksum=changed_checksum)

    changed_source = dict(rec)
    changed_source["source_hash"] = hashlib.sha256(b"different source").hexdigest()
    source_pack = tmp_path / "source-r2.jsonl.gz"
    source_checksum = _write_package(
        source_pack, [_meta(source_units=1, state="mt_complete"), changed_source]
    )
    with pytest.raises(ValueError, match="source_hash changed"):
        append_commentary(
            source_pack,
            _commentary_spec(release_version="2.0"),
            out,
            expected_checksum=source_checksum,
        )

    with pytest.raises(ValueError, match="metadata differs"):
        append_commentary(
            pack,
            _commentary_spec(release_version="2.0", attribution="different rights statement"),
            out,
            expected_checksum=changed_checksum,
        )
    with sqlite3.connect(out) as conn:
        stored = conn.execute(
            "SELECT body_json FROM commentary_entries WHERE work_id='mhcbg' AND unit_id=?",
            (unit_id,),
        ).fetchone()[0]
        assert "First." in stored
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM commentary_releases "
                "WHERE work_id='mhcbg' AND release_version='2.0'"
            ).fetchone()[0]
            == 0
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
            _meta(source_units=1, coverage_osis=osis, quality_label="draft"),
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
