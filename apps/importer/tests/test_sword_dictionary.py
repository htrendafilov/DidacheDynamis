"""Tests for the raw TEI Easton adapter (formats/sword_dictionary.py)."""

import gzip
import os
from pathlib import Path

import pytest

from bibleimport.formats import study
from bibleimport.formats.sword_dictionary import (
    EXPECTED_EASTON_ENTRIES,
    _append_run,
    load_dictionary_imp,
    load_raw_easton,
)

FIXTURES = Path(__file__).parent / "fixtures"
RAW_SOURCE = Path(__file__).parents[3] / "data" / "sources" / "Easton.raw.imp.gz"


def _runs(row):
    return [run for block in row.body["blocks"] for run in block.get("runs", [])]


def test_raw_adapter_parses_structure_and_classifies_every_ref():
    rows, diag = load_dictionary_imp(FIXTURES / "mini_easton_raw.imp")
    assert [row.headword for row in rows] == ["A", "Beta", "Gamma", "Gamma"]
    assert diag["entries"] == 4
    assert diag["reference_elements"] == 13
    assert diag["duplicate_keys"] == {"GAMMA": 2}
    assert diag["foreign_runs"] == 1

    bible = diag["bible_refs"]
    assert bible["total"] == 10
    assert bible["linked"] == 4  # Rev.1.8, Num.12, Lev.8 range, Jude.1.1
    assert bible["chapter_only"] == 1
    assert bible["chapter_via_range"] == 1
    assert bible["single_chapter_book"] == 1
    assert bible["corrected"] == 3  # 11, 21:6, 22:13 Gen placeholders -> Revelation
    assert bible["unsupported_book"] == 1
    assert bible["unreconciled"] == 2  # Lev. 42:6 explicit mismatch + orphaned 17
    easton = diag["easton_refs"]
    assert easton == {"total": 3, "linked": 1, "ambiguous": 1, "missing": 1}


def test_raw_adapter_repairs_rev_shorthand_and_keeps_labels():
    rows, diag = load_dictionary_imp(FIXTURES / "mini_easton_raw.imp")
    entry_a = next(row for row in rows if row.headword == "A")
    refs = {run["t"]: run.get("ref") for run in _runs(entry_a) if "ref" in run}
    assert refs["Rev. 1:8"] == "Rev.1.8"
    # The module's Gen placeholders are never copied; the paragraph context wins.
    assert refs["11"] == "Rev.1.11"
    assert refs["21:6"] == "Rev.21.6"
    assert refs["22:13"] == "Rev.22.13"
    assert refs["Num. 12"] == "Num.12"
    corrections = {(c["raw"], c["derived"], c["label"]) for c in diag["corrections"]}
    assert ("Gen.1.11", "Rev.1.11", "11") in corrections
    assert ("Gen.21.6", "Rev.21.6", "21:6") in corrections
    assert ("Gen.22.13", "Rev.22.13", "22:13") in corrections


def test_raw_adapter_chapter_range_and_single_chapter_book_labels():
    rows, _ = load_dictionary_imp(FIXTURES / "mini_easton_raw.imp")
    beta = next(row for row in rows if row.headword == "Beta")
    refs = {run["t"]: run.get("ref") for run in _runs(beta) if "ref" in run}
    assert refs["Lev. 8"] == "Lev.8.1-36"
    assert refs["Jude 1"] == "Jude.1.1"


def test_raw_adapter_dictionary_ref_and_plain_text_fallbacks():
    rows, diag = load_dictionary_imp(FIXTURES / "mini_easton_raw.imp")
    entry_a = next(row for row in rows if row.headword == "A")
    runs = _runs(entry_a)
    beta = next(run for run in runs if run.get("dictionary_ref"))
    assert beta["t"] == "BETA"
    assert beta["dictionary_ref"] == {
        "work_id": "easton",
        "entry_key": "BETA",
        "headword": "Beta",
    }
    assert "ref" not in beta
    # Missing / ambiguous / unsupported / unreconciled stay visible plain text.
    plain = [run["t"] for run in runs if "ref" not in run and "dictionary_ref" not in run]
    joined = "".join(plain)
    for text in ("NOPE", "GAMMA", "1 Macc. 1:57"):
        assert text in joined
    assert diag["missing_targets"] == [{"entry": "A", "target": "NOPE", "label": "NOPE"}]
    assert diag["ambiguous_targets"] == [{"entry": "A", "target": "GAMMA", "label": "GAMMA"}]
    assert diag["unsupported"] == [
        {"entry": "A", "raw": "1Macc.1.57", "label": "1 Macc. 1:57"}
    ]
    # Emphasis survives from <foreign>.
    assert any(run.get("emphasis") and "ruach" in run["t"] for run in runs)


def test_raw_adapter_explicit_mismatch_breaks_the_paragraph_anchor():
    rows, diag = load_dictionary_imp(FIXTURES / "mini_easton_raw.imp")
    gamma2 = next(row for row in rows if "second definition" in row.plain_text)
    plain = "".join(
        run["t"] for run in _runs(gamma2) if "ref" not in run and "dictionary_ref" not in run
    )
    assert "Lev. 42:6" in plain and "17" in plain
    reasons = [record["reason"] for record in diag["unreconciled"]]
    assert reasons == ["explicit_mismatch", "no_paragraph_context"]


def test_raw_adapter_rejects_malicious_xml(tmp_path):
    evil = tmp_path / "evil.imp"
    evil.write_text(
        "$$$X\n"
        '<!DOCTYPE entryFree [<!ENTITY leak SYSTEM "file:///etc/passwd">]>\n'
        '<entryFree n="X"> <title>X</title> <p>&leak;</p> </entryFree>\n',
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="malformed XML"):
        load_dictionary_imp(evil)


def test_ref_classification_gate_counts_elements_not_bytes(tmp_path):
    """A <ref> whose attributes wrap onto the next line is still one classified element."""
    source = tmp_path / "wrapped.imp"
    source.write_text(
        "$$$X\n"
        '<entryFree n="X"> <title>X</title> <p>See <ref\n'
        '   osisRef="Bible:Rev.1.8">Rev. 1:8</ref>.</p> </entryFree>\n',
        encoding="utf-8",
    )
    rows, diag = load_dictionary_imp(source)
    assert diag["reference_elements"] == 1
    assert diag["bible_refs"]["linked"] == 1
    assert [run.get("ref") for run in _runs(rows[0]) if "ref" in run] == ["Rev.1.8"]


def test_raw_adapter_entry_count_gate():
    with pytest.raises(ValueError, match="entry-count regression"):
        load_dictionary_imp(FIXTURES / "mini_easton_raw.imp", expected_entries=99)


def test_run_xor_is_enforced():
    with pytest.raises(ValueError, match="both ref and dictionary_ref"):
        _append_run([], {"t": "x", "ref": "John.3.16", "dictionary_ref": {}})


def test_stripped_imp_still_loads_via_legacy_path():
    rows, diag = load_dictionary_imp(FIXTURES / "mini_dictionary.imp")
    assert [row.headword for row in rows] == ["Grace", "Shepherd"]
    assert diag["format"] == "stripped"


def test_gzip_raw_source_loads(tmp_path):
    packed = tmp_path / "mini.imp.gz"
    with gzip.open(packed, "wt", encoding="utf-8") as handle:
        handle.write((FIXTURES / "mini_easton_raw.imp").read_text(encoding="utf-8"))
    rows, diag = load_dictionary_imp(packed)
    assert len(rows) == 4
    assert diag["format"] == "raw-tei"


def test_format_detection_enforces_expanded_imp_limit(tmp_path, monkeypatch):
    packed = tmp_path / "empty-entries.imp.gz"
    with gzip.open(packed, "wt", encoding="utf-8") as handle:
        handle.write("$$$EMPTY\n\n" * 20)

    monkeypatch.setattr(study, "_MAX_IMP_BYTES", 64)
    with pytest.raises(ValueError, match="expanded IMP exceeds 64 byte limit"):
        load_dictionary_imp(packed)


def _raw_source_available() -> bool:
    """An unhydrated Git LFS pointer is a ~130-byte text stub, not the real gzip."""
    return RAW_SOURCE.exists() and RAW_SOURCE.stat().st_size >= 1024


def test_full_source_audit_matches_verified_inventory():
    """The 24,779-element classification audit against the real raw export."""
    if not _raw_source_available():
        # This test is the only gate on link quality — the alias table is validated against one
        # module version, and a silent skip would let 23k links rot to plain text with CI green.
        message = f"raw Easton source not present (Git LFS object not pulled): {RAW_SOURCE}"
        if os.environ.get("CI"):
            pytest.fail(message)
        pytest.skip(message)
    rows, diag = load_raw_easton(RAW_SOURCE, expected_entries=EXPECTED_EASTON_ENTRIES)
    assert len(rows) == EXPECTED_EASTON_ENTRIES
    assert diag["reference_elements"] == 24779  # 24,092 Bible + 687 Easton, all classified
    assert diag["duplicate_keys"] == {"KADESH": 2, "SALMON": 2}
    assert diag["foreign_runs"] == 346
    assert diag["bible_refs"] == {
        "total": 24092,
        "linked": 23109,
        "chapter_only": 354,
        "chapter_via_range": 74,
        "single_chapter_book": 42,
        "corrected": 914,
        "unsupported_book": 3,
        "unreconciled": 66,
    }
    assert diag["easton_refs"] == {"total": 687, "linked": 617, "ambiguous": 1, "missing": 69}
    # The real Rev. 1:8,11; 21:6; 22:13 repair from the spec.
    repairs = {(c["entry"], c["raw"], c["derived"]) for c in diag["corrections"]}
    assert ("A", "Gen.1.11", "Rev.1.11") in repairs
    assert ("A", "Gen.21.6", "Rev.21.6") in repairs
    assert ("A", "Gen.22.13", "Rev.22.13") in repairs
    assert diag["ambiguous_targets"] == [{"entry": "ZALMON", "target": "SALMON", "label": "SALMON"}]
    unsupported = {(r["entry"], r["raw"]) for r in diag["unsupported"]}
    assert unsupported == {
        ("ABOMINATION", "1Macc.1.57"),
        ("ALTAR", "1Macc.4.47"),
        ("MACCABEES", "1Macc.2.60"),
    }
