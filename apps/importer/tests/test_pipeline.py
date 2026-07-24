import sqlite3
from pathlib import Path

from bibleimport.pipeline import (
    AlignmentExpectation,
    BibleSpec,
    append_bible,
    build_bible,
    source_sha256,
)
from bibleimport.schema import SCHEMA_VERSION

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"

SPEC = BibleSpec(
    work_id="test",
    title="Test Bible",
    abbrev="TB",
    language="en",
    versification="kjv",
    license="Public Domain",
    attribution="test attribution",
)


def build(tmp_path) -> Path:
    out = tmp_path / "content.sqlite"
    diag = build_bible(FIXTURE, SPEC, out, fmt="usfx")
    assert diag.ok, diag.errors
    return out


def test_build_writes_work_and_verses(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    work = c.execute("SELECT id,type,title,license,attribution,checksum FROM works").fetchone()
    assert work[0] == "test" and work[1] == "bible"
    assert work[5] and len(work[5]) == 64  # sha256 hex
    assert c.execute("SELECT count(*) FROM verses").fetchone()[0] == 2
    assert c.execute("SELECT count(*) FROM books").fetchone()[0] == 2
    assert c.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


def test_build_populates_fts(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    rows = c.execute("SELECT ref FROM bible_fts WHERE bible_fts MATCH 'shepherd'").fetchall()
    assert ("Ps.23.1",) in rows


def test_headings_written(tmp_path):
    db = build(tmp_path)
    c = sqlite3.connect(db)
    row = c.execute(
        "SELECT kind,text FROM headings WHERE osis_code='Ps' AND chapter=23"
    ).fetchone()
    assert row == ("title", "A Psalm by David.")


def test_build_is_deterministic(tmp_path):
    db1 = build(tmp_path / "a")
    db2 = build(tmp_path / "b")
    c1 = sqlite3.connect(db1)
    c2 = sqlite3.connect(db2)
    v1 = c1.execute("SELECT nodes_json FROM verses ORDER BY osis_code,chapter,verse").fetchall()
    v2 = c2.execute("SELECT nodes_json FROM verses ORDER BY osis_code,chapter,verse").fetchall()
    assert v1 == v2


def test_append_bible_adds_a_second_read_only_work(tmp_path):
    db = build(tmp_path)
    kjv_source = Path(__file__).parent / "fixtures" / "mini_kjv.imp"
    kjv_spec = BibleSpec(
        work_id="kjv",
        title="King James Version",
        abbrev="KJV",
        language="en",
        versification="kjv",
        license="GPL",
        attribution="CrossWire KJV test fixture",
        expected_alignment=AlignmentExpectation(
            base_work_id="test",
            base_checksum=source_sha256(FIXTURE),
            source_checksum=source_sha256(kjv_source),
            missing_in_other=frozenset({("Ps", 23, 1)}),
            missing_in_base=frozenset(
                {("Gen", 1, 1), ("1John", 1, 1), ("Rev", 1, 1)}
            ),
        ),
    )
    diag = append_bible(kjv_source, kjv_spec, db)
    assert diag.ok
    assert diag.alignment
    assert diag.alignment["unexpected"] == {
        "missing_in_other": [],
        "missing_in_base": [],
    }
    assert any("expected versification" in warning for warning in diag.warnings)
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT count(*) FROM works WHERE type='bible'").fetchone()[0] == 2
    text = conn.execute(
        "SELECT plain_text FROM verses WHERE work_id='kjv' AND osis_code='John'"
    ).fetchone()[0]
    assert text == "For God so loved the world."


def test_append_bible_with_exact_alignment_needs_no_allow_list(tmp_path):
    db = build(tmp_path)
    source = tmp_path / "matching.imp"
    source.write_text(
        "$$$Psalms 23:1\nThe LORD is my shepherd.\n"
        "$$$John 3:16\nFor God so loved the world.\n",
        encoding="utf-8",
    )
    diag = append_bible(
        source,
        BibleSpec(
            work_id="matching",
            title="Matching Bible",
            abbrev="MB",
            language="en",
            versification="kjv",
            license="test",
            attribution="test",
        ),
        db,
    )
    assert diag.ok
    assert diag.alignment
    assert diag.alignment["actual"] == {
        "missing_in_other": [],
        "missing_in_base": [],
    }


def test_unexpected_alignment_blocks_append_without_changing_database(tmp_path):
    db = build(tmp_path)
    before = sqlite3.connect(db).execute(
        "SELECT id,type,checksum FROM works ORDER BY id"
    ).fetchall()
    diag = append_bible(
        Path(__file__).parent / "fixtures" / "mini_kjv.imp",
        BibleSpec(
            work_id="blocked",
            title="Blocked Bible",
            abbrev="BB",
            language="en",
            versification="kjv",
            license="test",
            attribution="test",
        ),
        db,
    )

    assert not diag.ok
    assert any("unexpected versification" in error for error in diag.errors)
    after_conn = sqlite3.connect(db)
    assert after_conn.execute("SELECT id,type,checksum FROM works ORDER BY id").fetchall() == before
    assert after_conn.execute("SELECT count(*) FROM verses WHERE work_id='blocked'").fetchone()[0] == 0
