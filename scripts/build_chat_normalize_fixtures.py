#!/usr/bin/env python3
"""Build real CIR fixtures for apps/web/src/chat/normalize.test.ts (M9.3 step 2).

Work order: plan/chat/m9.3-grounded-assistant.md section 2 — "Test against real
fixtures in apps/importer/tests/fixtures/, not hand-written objects."

Builds the same two test content databases apps/api/tests/conftest.py builds
(same importer fixtures, same pipeline calls), boots the real FastAPI app
against each, and calls the real /api/v1 routes buildContext() will call in
production. The JSON responses are byte-for-byte what the browser receives,
so normalize.ts is tested against the actual API contract, not a guess at it.

Run with the apps/api venv, which has bibleimport installed editable:

    apps/api/.venv/bin/python scripts/build_chat_normalize_fixtures.py

Deterministic: same importer fixtures in, same output json out. Re-run after
a change to apps/importer/tests/fixtures/ or the CIR response shape.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "apps" / "importer"))

OUT = ROOT / "apps" / "web" / "src" / "chat" / "__fixtures__" / "cir.json"
FIXTURE_DIR = ROOT / "apps" / "importer" / "tests" / "fixtures"

# Shared verbatim with apps/api/tests/conftest.py's MINI_USFX. Keep both in
# sync by hand; duplicating avoids a test module depending on another
# package's test-only conftest.
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


def build_study_db(tmp_dir: Path) -> Path:
    from bibleimport.pipeline import (
        BibleSpec,
        BookSpec,
        append_book,
        append_study_content,
        build_bible,
    )

    src = tmp_dir / "mini_usfx.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_dir / "study.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
        ai_context_policy="allowed",
        source_url="https://ebible.org/", source_version="test fixture",
    )
    diag = build_bible(src, spec, out, fmt="usfx")
    assert diag.ok, diag.errors
    append_study_content(
        out,
        [FIXTURE_DIR / "mini_commentary.xml"],
        FIXTURE_DIR / "mini_dictionary.xml",
        FIXTURE_DIR / "mini_xrefs.tsv",
    )
    append_book(
        FIXTURE_DIR / "mini_genbook.imp",
        BookSpec(
            work_id="baptist1689",
            title="The Baptist Confession of Faith of 1689",
            abbrev="1689",
            language="en",
            license="Public Domain",
            attribution="Public-domain test fixture.",
            ai_context_policy="allowed",
            source_url="https://example.test/1689",
            source_version="test fixture",
        ),
        out,
    )
    return out


def build_strongs_db(tmp_dir: Path) -> Path:
    from bibleimport.pipeline import (
        AlignmentExpectation,
        BibleSpec,
        append_bible,
        append_strongs,
        build_bible,
        source_sha256,
    )

    src = tmp_dir / "mini_usfx_strongs.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_dir / "strongs.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
        ai_context_policy="allowed",
        source_url="https://ebible.org/", source_version="test fixture",
    )
    diag = build_bible(src, spec, out, fmt="usfx")
    assert diag.ok, diag.errors
    kjv_source = FIXTURE_DIR / "mini_kjv_strongs.imp"
    kjv_diag = append_bible(
        kjv_source,
        BibleSpec(
            work_id="kjv", title="King James Version", abbrev="KJV", language="en",
            versification="kjv", license="GPL",
            attribution="CrossWire KJV Strong's test fixture",
            ai_context_policy="allowed",
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
        greek_source=FIXTURE_DIR / "mini_strongs_greek.imp",
        hebrew_source=FIXTURE_DIR / "mini_strongs_hebrew.imp",
        expected_greek_entries=2,
        expected_greek_sequence_gaps=None,
        expected_greek_cjk_annotations=None,
        expected_greek_anomalies=None,
        expected_hebrew_entries=3,
        expected_hebrew_cleanups=0,
    )
    return out


def build_sword_commentary_db(tmp_dir: Path) -> Path:
    """A second, SWORD-format (.imp) mhc commentary, built separately because
    append_study_content requires all commentary_sources to share one format
    (study.py: `sword_commentary = all(...)`). This is the only fixture that
    exercises the superscript-verse-number -> `quotation` kind rule
    (formats/study.py:225) and the emphasis (italic) run flag, neither of
    which the ThML mini_commentary.xml fixture produces."""
    from bibleimport.pipeline import BibleSpec, append_study_content, build_bible

    src = tmp_dir / "mini_usfx_sword_commentary.xml"
    src.write_text(MINI_USFX, encoding="utf-8")
    out = tmp_dir / "sword_commentary.sqlite"
    spec = BibleSpec(
        work_id="web", title="World English Bible", abbrev="WEB", language="en",
        versification="kjv", license="Public Domain", attribution="WEB is public domain.",
        ai_context_policy="allowed",
        source_url="https://ebible.org/", source_version="test fixture",
    )
    diag = build_bible(src, spec, out, fmt="usfx")
    assert diag.ok, diag.errors
    append_study_content(
        out,
        [FIXTURE_DIR / "mini_commentary_raw.imp"],
        FIXTURE_DIR / "mini_dictionary.xml",  # required positional arg, unused by this fixture
        FIXTURE_DIR / "mini_xrefs.tsv",  # required positional arg, unused by this fixture
    )
    return out


def client_for(db_path: Path):
    from app import settings

    settings.CONTENT_DB_PATH = db_path
    from app.main import app
    from fastapi.testclient import TestClient

    return TestClient(app)


def get(client, path: str):
    res = client.get(path)
    if res.status_code != 200:
        raise RuntimeError(f"GET {path} -> {res.status_code}: {res.text}")
    return res.json()


def main() -> int:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        study_db = build_study_db(tmp_dir)
        strongs_db = build_strongs_db(tmp_dir)
        sword_commentary_db = build_sword_commentary_db(tmp_dir)

        fixtures: dict = {}

        with client_for(study_db) as c:
            fixtures["passage_john3"] = get(c, "/api/v1/works/web/passage/John/3")
            fixtures["passage_john3_v16"] = get(c, "/api/v1/works/web/passage/John/3?verses=16")
            fixtures["passage_ps23_poetry"] = get(c, "/api/v1/works/web/passage/Ps/23")
            fixtures["commentary_john3"] = get(c, "/api/v1/commentary/mhc/John/3")
            fixtures["dictionary_grace"] = get(c, "/api/v1/dictionary/easton/entry/Grace")
            fixtures["dictionary_shepherd"] = get(c, "/api/v1/dictionary/easton/entry/Shepherd")
            fixtures["xref_john3_16"] = get(c, "/api/v1/xref/John/3/16?preview_work=web")
            fixtures["general_book_baptist1689"] = get(c, "/api/v1/book/baptist1689")

        with client_for(strongs_db) as c:
            fixtures["strong_g0001_alpha"] = get(c, "/api/v1/lexicon/G0001")
            fixtures["strong_g1722_en"] = get(c, "/api/v1/lexicon/G1722")
            fixtures["strong_h0001"] = get(c, "/api/v1/lexicon/H0001")

        with client_for(sword_commentary_db) as c:
            fixtures["commentary_john3_sword_quotation"] = get(c, "/api/v1/commentary/mhc/John/3")

        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"wrote {OUT.relative_to(ROOT)} ({len(fixtures)} fixtures)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
