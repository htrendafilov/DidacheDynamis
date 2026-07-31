import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport.formats.genbook import load_genbook
from bibleimport.pipeline import BibleSpec, BookSpec, append_book, build_bible

FIXTURES = Path(__file__).parent / "fixtures"
SOURCES = Path(__file__).parents[3] / "data" / "sources"


def test_genbook_parser_materializes_tree_and_document_cir():
    rows = load_genbook(FIXTURES / "mini_genbook.imp")
    assert [row.section_id for row in rows] == [
        "chapter-1-scripture",
        "chapter-1-scripture.1",
        "chapter-1-scripture.2",
        "chapter-2-god",
    ]
    # A parent node takes its own path segment as its title, not its first child's ordinal.
    assert rows[0].title == "Chapter 1. Scripture"
    assert [row.title for row in rows[1:3]] == ["1", "2"]
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
    # The <reference osisRef> proof text becomes an interactive scripture-ref run.
    ref_runs = [
        run
        for block in paragraph.body["blocks"]
        for run in block.get("runs", [])
        if run.get("ref")
    ]
    assert ref_runs == [{"t": "2 Tim. 3:16", "superscript": True, "ref": "2Tim.3.16"}]


def test_bulgarian_release_source_has_localized_toc_and_complete_structure():
    rows = load_genbook(SOURCES / "BaptistConfession1689_BG.imp.gz")

    assert len(rows) == 35
    assert [row.section_id for row in rows[:4]] == [
        "content",
        "foreword",
        "chapter-1",
        "chapter-2",
    ]
    assert [row.title for row in rows[:4]] == [
        "Съдържание",
        "Предговор",
        "Глава 1 — За Свещените Писания",
        "Глава 2 — За Бога и за Светата Троица",
    ]
    assert rows[-1].title == "Заключително Изявление и Подписали се"
    scripture_reference_runs = sum(
        1
        for row in rows
        for block in row.body["blocks"]
        for run in block.get("runs", [])
        if run.get("ref")
    )
    assert scripture_reference_runs == 1145


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
        ai_context_policy="allowed",
    )
    assert build_bible(FIXTURES / "mini_usfx.xml", bible, out).ok
    book = BookSpec(
        work_id="baptist1689",
        title="The Baptist Confession of Faith of 1689",
        abbrev="1689",
        language="en",
        license="Public Domain",
        attribution="Public-domain test fixture.",
        ai_context_policy="allowed",
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
