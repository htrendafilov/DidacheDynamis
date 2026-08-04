import os
from pathlib import Path

import pytest
from defusedxml import ElementTree as DefusedET

from bibleimport.canonical import normalize_strong_id
from bibleimport.formats.sword_bible import (
    _w_lexical,
    lexical_cardinality_audit,
    load_sword_bible,
)

FIXTURE = Path(__file__).parent / "fixtures" / "mini_kjv.imp"
STRONGS_FIXTURE = Path(__file__).parent / "fixtures" / "mini_kjv_strongs.imp"
KJV_SOURCE = Path(__file__).parents[3] / "data" / "sources" / "KJV.imp.gz"


def test_sword_bible_maps_refs_text_red_letter_and_headings():
    books, verses, headings, tokens = load_sword_bible(FIXTURE)
    assert {book.osis for book in books} == {"Gen", "John", "1John", "Rev"}
    assert {(verse.osis, verse.chapter, verse.verse) for verse in verses} == {
        ("Gen", 1, 1),
        ("John", 3, 16),
        ("1John", 1, 1),
        ("Rev", 1, 1),
    }
    genesis = next(verse for verse in verses if verse.osis == "Gen")
    john = next(verse for verse in verses if verse.osis == "John")
    assert "hidden note" not in genesis.plain_text
    assert genesis.cir["lines"][0]["para_start"] is True
    assert all(run.get("wj") for run in john.cir["lines"][0]["runs"])
    assert headings[0].text == "The Revelation"
    # The lemma-less fixture is fully untagged: every span is a single NULL-id row.
    assert tokens
    assert all(token.strong_id is None and token.ordinal == 0 for token in tokens)


def test_normalize_strong_id_canonicalizes_padding_and_suffix():
    assert normalize_strong_id("H07225") == "H7225"
    assert normalize_strong_id("H0430") == "H0430"
    assert normalize_strong_id("G26") == "G0026"
    assert normalize_strong_id("g0031a") == "G0031A"
    assert normalize_strong_id("G1722") == "G1722"
    assert normalize_strong_id("X123") is None
    assert normalize_strong_id("H") is None
    assert normalize_strong_id("") is None


def _tokens_at(tokens, osis, chapter, verse):
    return [t for t in tokens if (t.osis, t.chapter, t.verse) == (osis, chapter, verse)]


def test_strongs_genesis_span_and_ordinal_keying():
    _, verses, _, tokens = load_sword_bible(STRONGS_FIXTURE)
    genesis = next(v for v in verses if (v.osis, v.chapter, v.verse) == ("Gen", 1, 1))
    assert genesis.plain_text == "In the beginning God created the heaven and the earth."
    runs = genesis.cir["lines"][0]["runs"]
    assert runs[0] == {"t": "In the beginning", "lemma": [{"id": "H7225"}]}
    created = next(run for run in runs if run["t"] == "created")
    assert created["lemma"] == [
        {"id": "H0853"},
        {"id": "H1254"},
    ]

    rows = _tokens_at(tokens, "Gen", 1, 1)
    created_rows = [t for t in rows if t.surface == "created"]
    assert [(t.position, t.ordinal) for t in created_rows] == [(4, 0), (4, 1)]
    assert created_rows[0].strong_id == "H0853"
    assert created_rows[0].morph_scheme is None and created_rows[0].morph_code is None
    assert created_rows[1].strong_id == "H1254"
    assert created_rows[1].morph_scheme is None and created_rows[1].morph_code is None
    # Untagged whitespace spans are single NULL-id rows.
    assert any(t.strong_id is None and t.ordinal == 0 and t.surface == " " for t in rows)


def test_strongs_transchange_survives_untagged():
    _, _, _, tokens = load_sword_bible(STRONGS_FIXTURE)
    rows = _tokens_at(tokens, "Gen", 1, 2)
    # Gen 1:2 also has a *tagged* 'was' (H1961); the italicised supplied word is separate.
    supplied = [t for t in rows if t.strong_id is None and "was" in t.surface]
    assert len(supplied) == 1
    assert supplied[0].surface == " was "
    assert supplied[0].ordinal == 0


def test_morphology_is_omitted_when_there_are_more_codes_than_ids():
    word = DefusedET.fromstring(
        '<w lemma="strong:H03455 strong:H07760" '
        'morph="strongMorph:TH8799 strongMorph:TH8675 strongMorph:TH8714">'
        "And there was set</w>",
        forbid_dtd=True,
        forbid_entities=True,
        forbid_external=True,
    )
    assert _w_lexical(word) == [{"id": "H3455"}, {"id": "H7760"}]


def test_strongs_john_multi_id_morphology_and_empty_surface():
    _, verses, _, tokens = load_sword_bible(STRONGS_FIXTURE)
    john = next(v for v in verses if (v.osis, v.chapter, v.verse) == ("John", 1, 1))
    word_runs = [run for run in john.cir["lines"][0]["runs"] if run["t"] == "the Word"]
    assert word_runs[0]["lemma"] == [
        {"id": "G3588", "s": "robinson", "m": "T-NSM"},
        {"id": "G3056", "s": "robinson", "m": "N-NSM"},
    ]
    rows = _tokens_at(tokens, "John", 1, 1)
    word_rows = [t for t in rows if t.surface == "the Word"]
    assert [(t.ordinal, t.strong_id, t.morph_code) for t in word_rows[:2]] == [
        (0, "G3588", "T-NSM"),
        (1, "G3056", "N-NSM"),
    ]

    # John 3:16: untranslated Greek words are empty-surface tagged spans; the whole
    # verse is red-letter, and short ids normalize to four digits.
    rows316 = _tokens_at(tokens, "John", 3, 16)
    empty = [t for t in rows316 if t.surface == ""]
    assert len(empty) == 2
    assert all(t.strong_id == "G3588" for t in empty)
    loved = next(t for t in rows316 if t.surface == "loved")
    assert loved.strong_id == "G0025"
    john316 = next(v for v in verses if (v.osis, v.chapter, v.verse) == ("John", 3, 16))
    assert john316.plain_text.startswith("For God so loved the world")
    assert all(run.get("wj") for run in john316.cir["lines"][0]["runs"])


def test_full_source_lexical_cardinality_matches_verified_inventory():
    if not KJV_SOURCE.exists() or KJV_SOURCE.stat().st_size < 1024:
        message = f"generated KJV source not present (run scripts/fetch-kjv.sh): {KJV_SOURCE}"
        if os.environ.get("CI"):
            pytest.fail(message)
        pytest.skip(message)

    assert lexical_cardinality_audit(KJV_SOURCE) == {
        "tagged_spans": 355850,
        "mismatched_spans": 745,
        "mismatches": {
            "NT:1:2": 1,
            "NT:2:1": 9,
            "NT:3:1": 3,
            "OT:2:1": 585,
            "OT:2:3": 131,
            "OT:3:1": 14,
            "OT:3:2": 1,
            "OT:3:5": 1,
        },
    }
