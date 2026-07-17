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
    from bibleimport.pipeline import BibleSpec, append_study_content, build_bible

    src = tmp_path_factory.mktemp("src") / "mini_usfx.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_path_factory.mktemp("data") / "content.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
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
    return out


@pytest.fixture()
def client(db_path, monkeypatch) -> TestClient:
    monkeypatch.setattr(settings, "CONTENT_DB_PATH", db_path)
    from app.main import app

    with TestClient(app) as c:
        yield c
