import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport.formats.study import (
    load_commentary,
    load_dictionary,
    load_sword_commentary,
    load_sword_dictionary,
    load_xrefs,
)
from bibleimport.pipeline import BibleSpec, append_study_content, build_bible

FIXTURES = Path(__file__).parent / "fixtures"


def test_commentary_parser_anchors_ranges_and_omits_passage_text():
    rows = load_commentary([FIXTURES / "mini_commentary.xml"])
    john = next(row for row in rows if row.osis == "John")
    assert (john.chapter, john.verse_start, john.verse_end) == (3, 16, 18)
    assert "love of God" in john.plain_text
    assert "For God so loved" not in john.plain_text
    assert john.body["blocks"][0] == {"kind": "heading", "text": "God's love."}


def test_dictionary_parser_preserves_paragraphs():
    rows = load_dictionary(FIXTURES / "mini_dictionary.xml")
    shepherd = next(row for row in rows if row.headword == "Shepherd")
    assert shepherd.sort_key == "shepherd"
    assert [block["kind"] for block in shepherd.body["blocks"]] == ["paragraph", "paragraph"]


def test_xref_parser_normalizes_osis_and_aggregates_duplicates():
    rows = load_xrefs(FIXTURES / "mini_xrefs.tsv")
    rom = next(row for row in rows if row.osis == "John" and row.target_ref == "Rom.5.8")
    assert rom.votes == 2
    assert any(row.target_ref == "1John.4.9-10" for row in rows)


def test_sword_imp_parsers_use_canonical_refs_and_display_headwords():
    commentary = load_sword_commentary([FIXTURES / "mini_commentary.imp"])
    assert [(row.osis, row.chapter, row.verse_start) for row in commentary] == [
        ("John", 3, 16),
        ("Ps", 23, 1),
    ]
    dictionary = load_sword_dictionary(FIXTURES / "mini_dictionary.imp")
    assert [row.headword for row in dictionary] == ["Grace", "Shepherd"]
    assert len(dictionary[0].body["blocks"]) == 2


def test_sword_raw_osis_preserves_commentary_structure_and_formatting():
    row = load_sword_commentary([FIXTURES / "mini_commentary_raw.imp"])[0]
    assert [block["kind"] for block in row.body["blocks"]] == [
        "heading",
        "quotation",
        "paragraph",
    ]
    quotation = row.body["blocks"][1]
    commentary = row.body["blocks"][2]
    assert any(run.get("superscript") and run["t"] == "16" for run in quotation["runs"])
    assert any(run.get("emphasis") and "only begotten" in run["t"] for run in quotation["runs"])
    assert any(run.get("emphasis") and "divine love" in run["t"] for run in commentary["runs"])
    assert "*" not in row.plain_text


def test_entity_declarations_are_rejected(tmp_path):
    malicious = tmp_path / "entity.xml"
    malicious.write_text(
        '<!DOCTYPE ThML [<!ENTITY leak SYSTEM "file:///etc/passwd">]>'
        "<ThML><glossary><term>X</term><def><p>&leak;</p></def></glossary></ThML>",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="entity declarations"):
        load_dictionary(malicious)


def test_append_study_content_populates_all_tables(tmp_path):
    out = tmp_path / "content.sqlite"
    spec = BibleSpec(
        work_id="web",
        title="World English Bible",
        abbrev="WEB",
        language="en",
        versification="kjv",
        license="Public Domain",
        attribution="WEB is public domain.",
    )
    diag = build_bible(FIXTURES / "mini_usfx.xml", spec, out)
    assert diag.ok
    stats = append_study_content(
        out,
        [FIXTURES / "mini_commentary.xml"],
        FIXTURES / "mini_dictionary.xml",
        FIXTURES / "mini_xrefs.tsv",
    )
    assert stats == {"commentary_entries": 2, "dictionary_entries": 2, "xrefs": 5}

    conn = sqlite3.connect(out)
    assert {row[0] for row in conn.execute("SELECT id FROM works")} == {
        "web",
        "mhc",
        "easton",
        "tsk",
    }
    body = conn.execute(
        "SELECT body_json FROM commentary_entries WHERE osis_code='John'"
    ).fetchone()[0]
    assert json.loads(body)["blocks"]
    assert conn.execute(
        "SELECT count(*) FROM commentary_fts WHERE commentary_fts MATCH 'gift'"
    ).fetchone()[0] == 1
    assert conn.execute(
        "SELECT count(*) FROM dictionary_fts WHERE dictionary_fts MATCH 'flock'"
    ).fetchone()[0] == 1
