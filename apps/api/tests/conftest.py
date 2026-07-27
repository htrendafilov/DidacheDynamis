from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import settings

MINI_USFX = """<?xml version="1.0" encoding="utf-8"?>
<usfx>
<languageCode>eng</languageCode>
<book id="PSA"><id id="PSA">x</id><h>Psalms</h>
<c id="23" />
<d style="d">A Psalm by David.</d>
<q style="q1"><v id="1" bcv="PSA.23.1" /><w>The</w> <w>LORD</w> is my shepherd;
</q><q level="2" style="q2">I shall lack nothing.<ve /></q>
</book>
<book id="JHN"><id id="JHN">x</id><h>John</h>
<c id="3" />
<p style="p"><v id="16" bcv="JHN.3.16" /><wj>For God so loved the world.</wj><ve /></p>
</book>
</usfx>
"""


@pytest.fixture(scope="session")
def db_path(tmp_path_factory) -> Path:
    from bibleimport.pipeline import (
        BibleSpec,
        BookSpec,
        append_book,
        append_study_content,
        build_bible,
    )

    src = tmp_path_factory.mktemp("src") / "mini_usfx.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_path_factory.mktemp("data") / "content.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
        source_url="https://ebible.org/", source_version="test fixture",
    )
    diag = build_bible(src, spec, out, fmt="usfx")
    assert diag.ok, diag.errors
    fixture_dir = Path(__file__).parents[2] / "importer" / "tests" / "fixtures"
    append_study_content(
        out,
        [fixture_dir / "mini_commentary.xml"],
        fixture_dir / "mini_dictionary.xml",
        fixture_dir / "mini_xrefs.tsv",
    )
    append_book(
        fixture_dir / "mini_genbook.imp",
        BookSpec(
            work_id="baptist1689",
            title="The Baptist Confession of Faith of 1689",
            abbrev="1689",
            language="en",
            license="Public Domain",
            attribution="Public-domain test fixture.",
            source_url="https://example.test/1689",
            source_version="test fixture",
        ),
        out,
    )
    return out


@pytest.fixture()
def client(db_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "CONTENT_DB_PATH", db_path)
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def strongs_db_path(tmp_path_factory) -> Path:
    """WEB + KJV-with-Strong's + the mini lexicons: the M8 lexical corpus, kept
    separate so the search tests' single-Bible corpus assumptions still hold."""
    from bibleimport.pipeline import (
        AlignmentExpectation,
        BibleSpec,
        append_bible,
        append_strongs,
        build_bible,
        source_sha256,
    )

    src = tmp_path_factory.mktemp("src") / "mini_usfx.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_path_factory.mktemp("data") / "content.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
        source_url="https://ebible.org/", source_version="test fixture",
    )
    diag = build_bible(src, spec, out, fmt="usfx")
    assert diag.ok, diag.errors
    fixture_dir = Path(__file__).parents[2] / "importer" / "tests" / "fixtures"
    kjv_source = fixture_dir / "mini_kjv_strongs.imp"
    kjv_diag = append_bible(
        kjv_source,
        BibleSpec(
            work_id="kjv",
            title="King James Version",
            abbrev="KJV",
            language="en",
            versification="kjv",
            license="GPL",
            attribution="CrossWire KJV Strong's test fixture",
            expected_alignment=AlignmentExpectation(
                base_work_id="web",
                base_checksum=source_sha256(src),
                source_checksum=source_sha256(kjv_source),
                missing_in_other=frozenset({("Ps", 23, 1)}),
                missing_in_base=frozenset({("Gen", 1, 1), ("Gen", 1, 2), ("John", 1, 1)}),
            ),
        ),
        out,
    )
    assert kjv_diag.ok, kjv_diag.errors
    append_strongs(
        out,
        greek_source=fixture_dir / "mini_strongs_greek.imp",
        hebrew_source=fixture_dir / "mini_strongs_hebrew.imp",
        expected_greek_entries=2,
        expected_greek_sequence_gaps=None,
        expected_greek_cjk_annotations=None,
        expected_greek_anomalies=None,
        expected_hebrew_entries=3,
        expected_hebrew_cleanups=0,
    )
    return out


@pytest.fixture()
def strongs_client(strongs_db_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "CONTENT_DB_PATH", strongs_db_path)
    from app.main import app

    with TestClient(app) as c:
        yield c
