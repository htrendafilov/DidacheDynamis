import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport.formats.genbook import load_genbook
from bibleimport.pipeline import BibleSpec, BookSpec, append_book, build_bible

FIXTURES = Path(__file__).parent / "fixtures"


def test_genbook_parser_materializes_tree_and_document_cir():
    rows = load_genbook(FIXTURES / "mini_genbook.imp")
    assert [row.section_id for row in rows] == [
        "chapter-1-scripture",
        "chapter-1-scripture.1",
        "chapter-1-scripture.2",
        "chapter-2-god",
    ]
    paragraph = rows[1]
    assert paragraph.parent_id == "chapter-1-scripture"
    assert paragraph.level == 2
    assert [block["kind"] for block in paragraph.body["blocks"]] == [
        "heading",
        "paragraph",
    ]
    assert any(
        run.get("superscript")
        for block in paragraph.body["blocks"]
        for run in block.get("runs", [])
    )
    assert "2 Tim. 3:16" in paragraph.plain_text


def test_genbook_parser_rejects_unknown_markup(tmp_path):
    source = tmp_path / "bad.imp"
    source.write_text("$$$/Section\n<script>alert(1)</script>\n", encoding="utf-8")
    with pytest.raises(ValueError, match="unsupported General Book markup"):
        load_genbook(source)


def test_append_book_populates_sections_and_fts(tmp_path):
    out = tmp_path / "content.sqlite"
    bible = BibleSpec(
        work_id="web",
        title="World English Bible",
        abbrev="WEB",
        language="en",
        versification="kjv",
        license="Public Domain",
        attribution="WEB is public domain.",
    )
    assert build_bible(FIXTURES / "mini_usfx.xml", bible, out).ok
    book = BookSpec(
        work_id="baptist1689",
        title="The Baptist Confession of Faith of 1689",
        abbrev="1689",
        language="en",
        license="Public Domain",
        attribution="Public-domain test fixture.",
    )
    assert append_book(FIXTURES / "mini_genbook.imp", book, out) == 4

    conn = sqlite3.connect(out)
    work = conn.execute(
        "SELECT type,license FROM works WHERE id='baptist1689'"
    ).fetchone()
    assert work == ("book", "Public Domain")
    body = conn.execute(
        "SELECT body_json FROM book_sections "
        "WHERE work_id='baptist1689' AND section_id='chapter-2-god'"
    ).fetchone()[0]
    assert json.loads(body)["blocks"]
    assert conn.execute(
        "SELECT count(*) FROM book_fts WHERE book_fts MATCH 'counsel'"
    ).fetchone()[0] == 1
