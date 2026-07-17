import sqlite3
from pathlib import Path

from bibleimport.pipeline import BibleSpec, build_bible

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
