import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport.books import CANON
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


def test_short_commentary_at_a_real_coordinate_is_never_scaffolding(tmp_path):
    """The regression that a global word threshold reintroduced.

    "Jesus wept." is two words of genuine commentary at John 11:35. Classifying by length
    discarded it while the audit still balanced — the exact failure M1 exists to eliminate,
    arriving through a different door. Coordinates decide what can be scaffolding; length never
    does.
    """
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "short.imp"
    src.write_text("$$$John 11:35\nJesus wept.\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    rows = load_sword_commentary([src], audit=audit)
    assert len(rows) == 1, "short commentary at a valid coordinate must import"
    assert rows[0].verse_start == 35
    assert audit.imported == 1
    assert audit.ignored_scaffolding == 0


def test_a_short_chapter_introduction_is_kept_too(tmp_path):
    from bibleimport.formats.study import load_sword_commentary

    src = tmp_path / "shortintro.imp"
    src.write_text("$$$John 3:0\nA brief note.\n", encoding="utf-8")
    rows = load_sword_commentary([src])
    assert len(rows) == 1 and rows[0].verse_start is None


@pytest.mark.parametrize(
    "body",
    [
        "prose " * 40,
        # Four words was under the old threshold and vanished into ignored_scaffolding while
        # the accounting still balanced. A milestone may say the book's name and nothing else.
        "A brief book introduction.",
    ],
)
def test_a_book_milestone_saying_more_than_the_title_is_fatal(tmp_path, body):
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "bookintro.imp"
    src.write_text(f"$$$John 0:0\n{body}\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    load_sword_commentary([src], audit=audit)
    assert audit.fatal_unmatched == ["John 0:0"]
    assert audit.ignored_scaffolding == 0


@pytest.mark.parametrize(
    "key,title",
    [("Obadiah 0:0", "Obadiah"), ("II John 0:0", "Second John"), ("Jude 0:0", "Jude")],
)
def test_a_book_milestone_saying_only_the_title_is_scaffolding(tmp_path, key, title):
    """The 5 real ones carry the book's own name, including spelled-out ordinals."""
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "title.imp"
    src.write_text(f"$$${key}\n<title>{title}</title>\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    load_sword_commentary([src], audit=audit)
    assert audit.ignored_scaffolding == 1
    assert audit.fatal_unmatched == []


def test_visible_text_that_produces_no_cir_is_fatal(tmp_path):
    """Emptiness is judged on the raw text, not on the parse.

    Judging after parsing meant a record the parser could not represent looked empty and was
    filed as scaffolding — visible text lost while the accounting still balanced.
    """
    from bibleimport.formats.study import CommentaryKeyAudit, load_sword_commentary

    src = tmp_path / "unparseable.imp"
    src.write_text("$$$Nowhere 1:1\n<p>Real prose disappears here.</p>\n", encoding="utf-8")
    audit = CommentaryKeyAudit()
    load_sword_commentary([src], audit=audit)
    assert audit.fatal_unmatched == ["Nowhere 1:1"]
    assert audit.ignored_scaffolding == 0


# The complete per-book map, generated from the checksummed source. Spot-checking three books
# let the other 63 and the canonical order drift while the global totals still passed.
# osis: (entries, introductions) — the complete map, in canonical order.
EXPECTED_PER_BOOK = {
    "Gen": (288, 49),
    "Exod": (175, 39),
    "Lev": (114, 26),
    "Num": (142, 35),
    "Deut": (134, 33),
    "Josh": (97, 23),
    "Judg": (92, 20),
    "Ruth": (15, 3),
    "1Sam": (132, 30),
    "2Sam": (99, 23),
    "1Kgs": (95, 21),
    "2Kgs": (106, 24),
    "1Chr": (94, 28),
    "2Chr": (118, 35),
    "Ezra": (35, 9),
    "Neh": (44, 12),
    "Esth": (30, 9),
    "Job": (175, 41),
    "Ps": (594, 149),
    "Prov": (547, 11),
    "Eccl": (53, 11),
    "Song": (33, 7),
    "Isa": (257, 65),
    "Jer": (199, 51),
    "Lam": (18, 4),
    "Ezek": (180, 47),
    "Dan": (51, 11),
    "Hos": (46, 13),
    "Joel": (12, 2),
    "Amos": (29, 8),
    "Obad": (4, 1),
    "Jonah": (12, 3),
    "Mic": (23, 6),
    "Nah": (9, 2),
    "Hab": (11, 2),
    "Zeph": (12, 2),
    "Hag": (6, 1),
    "Zech": (47, 13),
    "Mal": (12, 3),
    "Matt": (158, 27),
    "Mark": (84, 15),
    "Luke": (132, 23),
    "John": (116, 20),
    "Acts": (136, 27),
    "Rom": (63, 15),
    "1Cor": (82, 15),
    "2Cor": (50, 12),
    "Gal": (23, 5),
    "Eph": (23, 5),
    "Phil": (22, 3),
    "Col": (20, 3),
    "1Thess": (22, 4),
    "2Thess": (11, 2),
    "1Tim": (22, 5),
    "2Tim": (16, 3),
    "Titus": (10, 2),
    "Phlm": (2, 0),
    "Heb": (45, 12),
    "Jas": (17, 4),
    "1Pet": (26, 4),
    "2Pet": (15, 2),
    "1John": (30, 4),
    "2John": (6, 1),
    "3John": (4, 0),
    "Jude": (4, 0),
    "Rev": (76, 21),
}


def test_per_book_counts_match_the_checksummed_source_exactly():
    """Per-book counts mean nothing without the source they were measured from."""
    import hashlib

    source = Path("data/sources/MHC.imp.gz")
    if not source.exists():
        pytest.skip(f"real corpus not present: {source}")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    assert digest == "3238c932ece1ced9c4f824e6a293e3caf5c528cd369e4d3cbdeb41e089af61e0", (
        "MHC source changed; re-measure plan/mhc_translation/08_english_baseline.md and "
        "regenerate EXPECTED_PER_BOOK before updating this checksum"
    )

    rows, _ = _mhc_audit()
    entries: dict[str, int] = {}
    intros: dict[str, int] = {}
    for row in rows:
        entries[row.osis] = entries.get(row.osis, 0) + 1
        if row.verse_start is None:
            intros[row.osis] = intros.get(row.osis, 0) + 1
    actual = {osis: (n, intros.get(osis, 0)) for osis, n in entries.items()}
    assert actual == EXPECTED_PER_BOOK, "per-book entry/introduction counts drifted"

    # Canonical order, not just membership: the map is written in canon order and the books
    # present must be exactly the canon's, in that order.
    canon_order = [b.osis for b in CANON if b.osis in actual]
    assert list(EXPECTED_PER_BOOK) == canon_order
    assert len(canon_order) == 66


def test_the_real_corpus_accounting_balances():
    rows, audit = _mhc_audit()
    assert audit.total == 5506, "buckets must sum to the raw key count"
    assert audit.fatal_unmatched == []
    assert audit.imported == 5355
    assert audit.ignored_scaffolding == 151
    assert len({r.osis for r in rows}) == 66, "all 66 canonical books must be present"
    assert sum(1 for r in rows if r.verse_start is None) == 1106


def test_append_study_content_refuses_to_build_when_a_key_is_unclassifiable(tmp_path):
    """The raise is the only thing that turns classification into a build failure.

    The loader tests assert that unplaceable prose lands in `fatal_unmatched`, but a refactor
    could keep the buckets and drop the raise without CI noticing — and a bucket nobody acts on
    is exactly the silent success M1 removed.
    """
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
    assert build_bible(FIXTURES / "mini_usfx.xml", spec, out, fmt="usfx").ok

    bad = tmp_path / "bad.imp"
    bad.write_text("$$$Nowhere 1:1\n" + "prose " * 40 + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="could not be placed"):
        append_study_content(
            out,
            [bad],
            FIXTURES / "mini_easton_raw.imp",
            FIXTURES / "mini_xrefs.tsv",
        )

    # And nothing was written for the work whose import failed.
    with sqlite3.connect(out) as conn:
        rows = conn.execute("SELECT COUNT(*) FROM commentary_entries WHERE work_id='mhc'").fetchone()
    assert rows[0] == 0, "a refused build must not leave commentary rows behind"


def test_add_study_and_build_all_publish_the_same_mhc_statistics():
    """Both documented entry points must carry the key accounting, not just build-all."""
    from bibleimport.cli import _mhc_statistics

    stats = {
        "commentary_entries": 5355,
        "commentary_keys": {"imported": 5355, "ignored_scaffolding": 151, "fatal_unmatched": 0},
    }
    assert _mhc_statistics(stats)["commentary_keys"]["imported"] == 5355
    # Non-SWORD commentary has no buckets; the helper must not invent them.
    assert "commentary_keys" not in _mhc_statistics({"commentary_entries": 3})
