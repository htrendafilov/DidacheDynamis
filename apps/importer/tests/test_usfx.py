import json
import zipfile
from pathlib import Path

import pytest

from bibleimport.formats import usfx
from bibleimport.validation import align_versification, validate

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"


def parse():
    return usfx.load_usfx(FIXTURE)


def test_non_canonical_book_skipped():
    books, verses, _ = parse()
    codes = {b.osis for b in books}
    assert codes == {"Ps", "John"}  # FRT dropped
    assert all(v.osis in codes for v in verses)


def test_poetry_lines_and_levels():
    _, verses, _ = parse()
    ps = next(v for v in verses if v.osis == "Ps" and v.chapter == 23 and v.verse == 1)
    lines = ps.cir["lines"]
    assert [ln["kind"] for ln in lines] == ["q", "q"]
    assert [ln["level"] for ln in lines] == [1, 2]
    assert ps.plain_text == "The LORD is my shepherd; I shall lack nothing."


def test_psalm_title_captured_as_heading():
    _, _, headings = parse()
    titles = [h for h in headings if h.osis == "Ps" and h.chapter == 23]
    assert len(titles) == 1
    assert titles[0].kind == "title"
    assert titles[0].before_verse == 1
    assert titles[0].text == "A Psalm by David."


def test_words_of_jesus_and_footnote_excluded():
    _, verses, _ = parse()
    jn = next(v for v in verses if v.osis == "John")
    # red-letter runs present
    assert any(r.get("wj") for ln in jn.cir["lines"] for r in ln["runs"])
    # footnote text must not leak into the verse
    assert "footnote" not in jn.plain_text
    assert jn.plain_text.startswith("For God so loved the world")
    assert jn.plain_text.endswith("that he gave his Son.")


def test_paragraph_start_flag():
    _, verses, _ = parse()
    jn = next(v for v in verses if v.osis == "John")
    assert jn.cir["lines"][0]["kind"] == "p"
    assert jn.cir["lines"][0]["para_start"] is True


def test_bcv_attribute_drives_reference():
    _, verses, _ = parse()
    assert any(v.osis == "John" and v.chapter == 3 and v.verse == 16 for v in verses)


def test_validate_ok_with_missing_books_warning():
    books, verses, headings = parse()
    d = validate(books, verses, headings)
    assert d.ok  # no errors
    assert any("missing canonical books" in w for w in d.warnings)
    assert d.stats["verses"] == len(verses)


def test_alignment_hook_reports_symmetric_difference():
    base = {("John", 3, 16), ("Ps", 23, 1)}
    other = {("John", 3, 16), ("Ps", 23, 2)}
    res = align_versification(base, other)
    assert res["missing_in_other"] == [("Ps", 23, 1)]
    assert res["missing_in_base"] == [("Ps", 23, 2)]


def test_cir_is_json_serialisable():
    _, verses, _ = parse()
    for v in verses:
        json.dumps(v.cir)  # must not raise


def test_raw_usfx_rejects_oversized_xml(tmp_path, monkeypatch):
    source = tmp_path / "large_usfx.xml"
    source.write_bytes(b"x" * 65)
    monkeypatch.setattr(usfx, "MAX_EXPANDED_XML_BYTES", 64)

    with pytest.raises(ValueError, match="USFX XML exceeds 64 bytes"):
        usfx.load_usfx(source)


def test_zip_rejects_oversized_declared_member_before_extraction(tmp_path, monkeypatch):
    source = tmp_path / "large.zip"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("large_usfx.xml", b"x" * 65)
    monkeypatch.setattr(usfx, "MAX_EXPANDED_XML_BYTES", 64)

    with pytest.raises(ValueError, match="expanded USFX XML exceeds 64 bytes"):
        usfx.load_usfx(source)


def test_zip_rejects_excessive_compression_ratio(tmp_path, monkeypatch):
    source = tmp_path / "bomb.zip"
    xml = b"<usfx>" + (b" " * 4096) + b"</usfx>"
    with zipfile.ZipFile(source, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("bomb_usfx.xml", xml)
    monkeypatch.setattr(usfx, "MAX_COMPRESSION_RATIO", 2)

    with pytest.raises(ValueError, match="compression ratio"):
        usfx.load_usfx(source)
