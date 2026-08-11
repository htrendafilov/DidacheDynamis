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
        ai_context_policy="allowed",
    )
    diag = build_bible(FIXTURES / "mini_usfx.xml", spec, out)
    assert diag.ok
    stats, easton_diag = append_study_content(
        out,
        [FIXTURES / "mini_commentary.xml"],
        FIXTURES / "mini_dictionary.xml",
        FIXTURES / "mini_xrefs.tsv",
    )
    assert stats == {"commentary_entries": 2, "dictionary_entries": 2, "xrefs": 5}
    assert easton_diag["format"] == "thml"

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


def test_normalize_osis_ref_validates_and_collapses_ranges():
    from bibleimport.books import normalize_osis_ref

    assert normalize_osis_ref("John.3.16") == "John.3.16"
    assert normalize_osis_ref("2Tim.3.16") == "2Tim.3.16"
    assert normalize_osis_ref("John.3.1-John.3.19") == "John.3.1-19"
    assert normalize_osis_ref("Ps.23.1-3") == "Ps.23.1-3"
    assert normalize_osis_ref("John.3.5-John.4.2") == "John.3.5"  # cross-chapter -> start verse
    assert normalize_osis_ref("John.3.19-John.3.1") == "John.3.19"  # end <= start ignored
    assert normalize_osis_ref("Nope.1.1") is None
    assert normalize_osis_ref("garbage") is None
    assert normalize_osis_ref("") is None


def test_sword_commentary_preserves_scripture_references():
    from bibleimport.formats.study import _sword_osis_document

    fragment = (
        '<div type="x-p" sID="p1"/>See '
        '<reference osisRef="John.3.16">John 3:16</reference> and '
        '<reference osisRef="Ps.23.1-Ps.23.3">Ps 23:1-3</reference>.'
        '<div type="x-p" eID="p1"/>'
    )
    body, plain = _sword_osis_document(fragment)
    runs = body["blocks"][0]["runs"]
    refs = [(run["t"], run.get("ref")) for run in runs if run.get("ref")]
    assert refs == [("John 3:16", "John.3.16"), ("Ps 23:1-3", "Ps.23.1-3")]
    assert "See" in plain and "John 3:16" in plain


# --- M1: corpus repair -------------------------------------------------------------------
# The import shipped 48 of 66 books and 3,479 of 5,506 keys while reporting success. These
# assert the two causes stay fixed and that the accounting cannot silently stop balancing.

def _mhc_audit():
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    source = Path("data/sources/MHC.imp.gz")
    if not source.exists():
        pytest.skip(f"real corpus not present: {source}")
    audit = CommentaryKeyAudit()
    return load_sword_commentary([source], audit=audit), audit


@pytest.mark.parametrize(
    "key_form,expected",
    [
        ("I Samuel", "1Sam"),
        ("II Kings", "2Kgs"),
        ("III John", "3John"),
        ("I Corinthians", "1Cor"),
        ("II Chronicles", "2Chr"),
        ("Revelation of John", "Rev"),
        # The Arabic forms must keep working; the Roman aliases are additions, not replacements.
        ("1 Samuel", "1Sam"),
        ("Revelation", "Rev"),
    ],
)
def test_book_aliases_resolve_every_form_the_source_uses(key_form, expected):
    from bibleimport.formats.study import _osis_book

    assert _osis_book(key_form) == expected


def test_chapter_introductions_import_with_null_verses(tmp_path):
    from bibleimport.formats.study import load_sword_commentary

    src = tmp_path / "intro.imp"
    src.write_text(
        "$$$John 3:0\n" + "word " * 40 + "\n$$$John 3:16\n" + "verse " * 40 + "\n",
        encoding="utf-8",
    )
    rows = load_sword_commentary([src])
    intro = [r for r in rows if r.verse_start is None]
    verse = [r for r in rows if r.verse_start is not None]
    assert len(intro) == 1 and intro[0].chapter == 3
    assert intro[0].verse_end is None
    assert len(verse) == 1 and verse[0].verse_start == 16


def test_a_record_carrying_prose_that_cannot_be_placed_is_fatal(tmp_path):
    """The old loader skipped anything it could not place. Silence was the bug."""
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "unknown.imp"
    src.write_text("$$$Nowhere 1:1\n" + "prose " * 40 + "\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    rows = load_sword_commentary([src], audit=audit)
    assert rows == []
    assert audit.fatal_unmatched == ["Nowhere 1:1"]
    assert audit.total == 1


def test_an_empty_unplaceable_record_is_scaffolding_not_fatal(tmp_path):
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "heading.imp"
    src.write_text("$$$[ Testament 1 Heading ]\n\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    assert load_sword_commentary([src], audit=audit) == []
    assert audit.ignored_scaffolding == 1
    assert audit.fatal_unmatched == []


def test_a_record_inside_the_measured_gap_is_fatal_not_classified(tmp_path):
    """The <5-word threshold is justified by a gap with nothing in it.

    A record of 10 words means the corpus no longer has that gap, so the threshold's
    justification is void and the record must stop the build rather than be guessed at.
    """
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "gap.imp"
    src.write_text("$$$John 0:0\n" + "word " * 10 + "\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    load_sword_commentary([src], audit=audit)
    assert audit.fatal_unmatched == ["John 0:0"], "a gap record must not be silently classified"


def test_the_real_corpus_accounting_balances():
    rows, audit = _mhc_audit()
    assert audit.total == 5506, "buckets must sum to the raw key count"
    assert audit.fatal_unmatched == []
    assert audit.imported == 5355
    assert audit.ignored_scaffolding == 151
    assert len({r.osis for r in rows}) == 66, "all 66 canonical books must be present"
    assert sum(1 for r in rows if r.verse_start is None) == 1106


def test_the_real_corpus_has_no_record_inside_the_measured_gap():
    """Guards the threshold's justification against a future source update."""
    from bibleimport.formats.study import (
        _PROSE_MIN_WORDS,
        _SCAFFOLDING_MAX_WORDS,
        _imp_entries,
        _plain_document,
        _sword_osis_document,
    )

    source = Path("data/sources/MHC.imp.gz")
    if not source.exists():
        pytest.skip(f"real corpus not present: {source}")
    offenders = []
    for key, text in _imp_entries(source):
        _, plain = (
            _sword_osis_document(text) if text.lstrip().startswith("<") else _plain_document(text)
        )
        if _SCAFFOLDING_MAX_WORDS <= len(plain.split()) <= _PROSE_MIN_WORDS:
            offenders.append(key)
    assert offenders == [], f"records inside the scaffolding/prose gap: {offenders[:5]}"

