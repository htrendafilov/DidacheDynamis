from pathlib import Path

import pytest

from bibleimport.formats.strongs_lexicon import (
    load_strongs_greek,
    load_strongs_hebrew,
)

FIXTURES = Path(__file__).parent / "fixtures"
GREEK = FIXTURES / "mini_strongs_greek.imp"
HEBREW = FIXTURES / "mini_strongs_hebrew.imp"
GREEK_MULTIPRON = FIXTURES / "mini_strongs_greek_multipron.imp"
MINI_GREEK_EXPECTATIONS = {
    "expected_sequence_gaps": None,
    "expected_cjk_annotations": None,
    "expected_anomalies": None,
}


def test_greek_parses_entries_and_skips_front_matter_and_stubs():
    rows, diag = load_strongs_greek(GREEK, expected_entries=2, **MINI_GREEK_EXPECTATIONS)
    assert [row.strong_id for row in rows] == ["G0001", "G1722"]
    alpha = rows[0]
    assert alpha.language == "grc"
    assert alpha.lemma == "ἄλφα"
    assert alpha.transliteration == "a"
    assert alpha.pronunciation == "al'-fah"
    assert alpha.definition["see"] == ["G0427", "G0260"]
    assert "first letter of the alphabet" in alpha.definition["text"]
    en = rows[1]
    assert en.lemma == "ἐν"
    assert en.definition["see"] == ["G1519"]
    assert diag["skipped_front_matter"] == 1
    assert diag["skipped_stubs"] == 1  # the @@@@ placeholder key 00031A
    assert diag["entries"] == 2


def test_greek_multi_form_pronunciations_drop_every_brace():
    rows, _ = load_strongs_greek(GREEK_MULTIPRON, expected_entries=3, **MINI_GREEK_EXPECTATIONS)
    prons = {row.strong_id: row.pronunciation for row in rows}
    assert prons["G0210"] == "ak'-ohn 或 hekon hek-ohn'"
    assert prons["G0206"] == "Pagos ar'-i-os pag'-os"
    assert prons["G1640"] == "el-as'-sone 和 elatton (el-at-tone'"  # unbalanced mid-string


def test_greek_entry_count_regression_fails_loudly():
    with pytest.raises(ValueError, match="entry-count regression"):
        load_strongs_greek(GREEK, expected_entries=999, **MINI_GREEK_EXPECTATIONS)


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"expected_sequence_gaps": 999}, "sequence-gap regression"),
        ({"expected_cjk_annotations": 999}, "CJK-annotation regression"),
        (
            {"expected_anomalies": frozenset({("unexpected", "test")})},
            "anomaly regression",
        ),
    ],
)
def test_greek_known_diagnostics_regressions_fail_loudly(override, message):
    expectations = {**MINI_GREEK_EXPECTATIONS, **override}
    with pytest.raises(ValueError, match=message):
        load_strongs_greek(
            GREEK,
            expected_entries=2,
            **expectations,
        )


def test_hebrew_parses_plain_entries_with_multiword_lemmas():
    rows, diag = load_strongs_hebrew(HEBREW, expected_entries=3, expected_cleanups=0)
    assert [row.strong_id for row in rows] == ["H0001", "H0002", "H0025"]
    ab = rows[0]
    assert ab.language == "hbo"
    assert ab.lemma == "'ab"
    assert ab.pronunciation == "awb"
    assert ab.transliteration is None  # transliteration-only module
    assert "primitive word; father" in ab.definition["text"]
    assert rows[1].definition["see"] == ["H0001"]
    abi = rows[2]
    assert abi.lemma == "'Abiy Gib`own"
    assert abi.pronunciation == "ab-ee' ghib-one'"
    assert diag["skipped_front_matter"] == 1
    assert diag["spurious_sequences_removed"] == 0


def test_hebrew_removes_spurious_bytes_and_counts_them(tmp_path):
    source = tmp_path / "hebrew.imp"
    body = "$$$00001\n 1  'ab  awb\n\n a primitive word; father, in a literal and immediate, or\n"
    source.write_bytes(body.encode("cp1252") + b" &\x8a chief.\n")
    rows, diag = load_strongs_hebrew(source, expected_entries=1, expected_cleanups=1)
    assert "Š" not in rows[0].definition["text"]
    assert rows[0].definition["text"].endswith("chief.")
    assert diag["spurious_sequences_removed"] == 1


def test_hebrew_cleanup_count_change_fails_loudly(tmp_path):
    source = tmp_path / "hebrew.imp"
    source.write_bytes("$$$00001\n 1  'ab  awb\n\n father.\n".encode("cp1252"))
    with pytest.raises(ValueError, match="spurious-sequence count changed"):
        load_strongs_hebrew(source, expected_entries=1, expected_cleanups=7)


def test_hebrew_entry_count_regression_fails_loudly():
    with pytest.raises(ValueError, match="entry-count regression"):
        load_strongs_hebrew(HEBREW, expected_entries=999, expected_cleanups=0)
