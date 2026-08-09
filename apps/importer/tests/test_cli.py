import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport import cli
from bibleimport.cli import main

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"
FIXTURES = Path(__file__).parent / "fixtures"


def test_kjv_build_input_is_generated_and_checksum_pinned():
    assert cli.SOURCE_FILES["kjv"] == "KJV.imp.gz"
    assert cli.KJV_SPEC.expected_alignment is not None
    # The decompressed mod2imp export, not the gzip carrying it: scripts/fetch-kjv.sh writes
    # that gzip with whichever implementation the build machine has, and Apple gzip and GNU
    # gzip disagree byte-for-byte on identical input.
    assert cli.KJV_SPEC.source_is_generated is True
    assert (
        cli.KJV_SPEC.expected_alignment.source_checksum
        == "6b2a9ab832b597ffb90929d3c7ac0b2756991cdc6bf5d30eab046308aedca7ed"
    )


def test_web_carries_ebible_required_attribution_in_full():
    # eBible.org's required wording has three sentences; the middle one is the public-domain
    # grant. It was missing, so works.attribution — the string WorkFooter renders — asserted the
    # trademark without the rights it qualifies. data/sources/README.md and NOTICE record this
    # same string as required, and this spec is the only copy that reaches a reader.
    assert cli.WEB_SPEC.attribution == (
        "The World English Bible is in the Public Domain. That means that it is not "
        'copyrighted. However, "World English Bible" is a Trademark of eBible.org.'
    )


def test_baptist_confession_uses_reviewed_source_and_provenance():
    assert cli.SOURCE_FILES["baptist1689"] == "BaptistConfession1689-ed1.imp.gz"
    spec = cli.BAPTIST_1689_SPEC
    assert spec.license == "Public Domain"
    assert "editorial revision 1" in (spec.source_version or "")
    assert "historical 1677 text" in spec.attribution
    assert "No doctrinal or stylistic modernization" in spec.attribution


def test_bulgarian_baptist_confession_is_a_cc0_release_source():
    assert cli.SOURCE_FILES["baptist1689bg"] == "BaptistConfession1689_BG.imp.gz"
    spec = cli.BAPTIST_1689_BG_SPEC
    assert spec.work_id == "baptist1689bg"
    assert spec.language == "bg"
    assert spec.license == "CC0 1.0 Universal"
    assert spec.ai_context_policy == "allowed"
    assert "CC0 1.0 Universal" in spec.attribution
    assert cli.GENERAL_BOOK_SPECS == (
        ("baptist1689", cli.BAPTIST_1689_SPEC),
        ("baptist1689bg", spec),
    )


def test_build_web_writes_default_diagnostics_and_audit_line(tmp_path, capsys):
    out = tmp_path / "content.sqlite"

    assert main(["build-web", "--source", str(FIXTURE), "--out", str(out)]) == 0

    report_path = Path(f"{out}.diagnostics.json")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["result"] == "ok"
    assert report["output"] == "content.sqlite"
    assert report["imports"][0]["work_id"] == "web"
    assert report["imports"][0]["source"] == "mini_usfx.xml"
    assert len(report["imports"][0]["sha256"]) == 64
    assert report["imports"][0]["ai_context_policy"] == "allowed"
    audit_line = next(
        line for line in capsys.readouterr().out.splitlines() if line.startswith("AUDIT ")
    )
    assert str(FIXTURE.parent) not in audit_line
    assert '"ai_context_policy":"allowed"' in audit_line


def test_build_requires_ai_context_policy(tmp_path, capsys):
    out = tmp_path / "content.sqlite"
    with pytest.raises(SystemExit):
        main(
            [
                "build",
                "--format",
                "usfx",
                "--source",
                str(FIXTURE),
                "--out",
                str(out),
                "--work-id",
                "test",
                "--title",
                "Test Bible",
                "--abbrev",
                "TB",
                "--language",
                "en",
                "--license",
                "Public Domain",
                "--attribution",
                "test",
            ]
        )
    assert "ai-context-policy" in capsys.readouterr().err
    assert not out.exists()


def test_build_accepts_explicit_ai_context_policy(tmp_path):
    out = tmp_path / "content.sqlite"
    code = main(
        [
            "build",
            "--format",
            "usfx",
            "--source",
            str(FIXTURE),
            "--out",
            str(out),
            "--work-id",
            "test",
            "--title",
            "Test Bible",
            "--abbrev",
            "TB",
            "--language",
            "en",
            "--license",
            "Public Domain",
            "--attribution",
            "test",
            "--ai-context-policy",
            "prohibited",
        ]
    )
    assert code == 0
    conn = sqlite3.connect(out)
    assert conn.execute(
        "SELECT ai_context_policy FROM works WHERE id='test'"
    ).fetchone()[0] == "prohibited"


def test_build_accepts_conditional_ai_context_policy(tmp_path):
    """A licence may permit AI use only under no-training terms — see M9.1."""
    out = tmp_path / "content.sqlite"
    code = main(
        [
            "build",
            "--format",
            "usfx",
            "--source",
            str(FIXTURE),
            "--out",
            str(out),
            "--work-id",
            "test",
            "--title",
            "Test Bible",
            "--abbrev",
            "TB",
            "--language",
            "en",
            "--license",
            "Licensed",
            "--attribution",
            "test",
            "--ai-context-policy",
            "allowed_no_training",
        ]
    )
    assert code == 0
    conn = sqlite3.connect(out)
    assert conn.execute(
        "SELECT ai_context_policy FROM works WHERE id='test'"
    ).fetchone()[0] == "allowed_no_training"


def test_build_rejects_an_unknown_ai_context_policy(tmp_path, capsys):
    """The CHECK constraint and the CLI choices must stay in step."""
    out = tmp_path / "content.sqlite"
    with pytest.raises(SystemExit):
        main(
            [
                "build",
                "--format",
                "usfx",
                "--source",
                str(FIXTURE),
                "--out",
                str(out),
                "--work-id",
                "test",
                "--title",
                "Test Bible",
                "--abbrev",
                "TB",
                "--language",
                "en",
                "--license",
                "Public Domain",
                "--attribution",
                "test",
                "--ai-context-policy",
                "maybe",
            ]
        )
    assert "ai-context-policy" in capsys.readouterr().err
    assert not out.exists()


def test_validation_failure_writes_atomic_diagnostics_without_database(tmp_path):
    source = tmp_path / "invalid_usfx.xml"
    source.write_text(
        """<usfx><book id="GEN"><h>Genesis</h><c id="1"/>
        <p><v id="0" bcv="GEN.1.0"/>invalid<ve/></p></book></usfx>""",
        encoding="utf-8",
    )
    out = tmp_path / "content.sqlite"
    report_path = tmp_path / "report.json"

    code = main(
        [
            "build-web",
            "--source",
            str(source),
            "--out",
            str(out),
            "--report",
            str(report_path),
        ]
    )

    assert code == 1
    assert not out.exists()
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["result"] == "failed"
    assert report["imports"][0]["result"] == "failed"
    assert any("non-positive ref" in error for error in report["imports"][0]["errors"])
    assert not (tmp_path / ".report.json.tmp").exists()


def test_report_cannot_overwrite_the_content_database(tmp_path):
    out = tmp_path / "content.sqlite"
    with pytest.raises(SystemExit):
        main(
            [
                "build-web",
                "--source",
                str(FIXTURE),
                "--out",
                str(out),
                "--report",
                str(out),
            ]
        )
    assert not out.exists()


def test_add_strongs_appends_lexicons_and_reports_diagnostics(tmp_path, capsys, monkeypatch):
    out = tmp_path / "content.sqlite"
    assert main(["build-web", "--source", str(FIXTURE), "--out", str(out)]) == 0
    capsys.readouterr()

    # The real add-strongs enforces the full module entry counts; the mini fixtures
    # carry a handful of entries, so inject the fixture counts (loader/pipeline tests
    # cover the count gates themselves).
    real_append_strongs = cli.append_strongs

    def append_with_fixture_counts(out_db, *, greek_source, hebrew_source):
        return real_append_strongs(
            out_db,
            greek_source=greek_source,
            hebrew_source=hebrew_source,
            expected_greek_entries=2,
            expected_greek_sequence_gaps=None,
            expected_greek_cjk_annotations=None,
            expected_greek_anomalies=None,
            expected_hebrew_entries=3,
            expected_hebrew_cleanups=0,
        )

    monkeypatch.setattr(cli, "append_strongs", append_with_fixture_counts)

    code = main(
        [
            "add-strongs",
            "--greek-source",
            str(FIXTURES / "mini_strongs_greek.imp"),
            "--hebrew-source",
            str(FIXTURES / "mini_strongs_hebrew.imp"),
            "--out",
            str(out),
        ]
    )

    assert code == 0
    stdout = capsys.readouterr().out
    assert "strongs_greek_entries=2" in stdout
    assert "strongs_hebrew_entries=3" in stdout
    audits = [line for line in stdout.splitlines() if line.startswith("AUDIT ")]
    assert len(audits) == 2
    report = json.loads(Path(f"{out}.diagnostics.json").read_text(encoding="utf-8"))
    assert report["result"] == "ok"
    by_work = {record["work_id"]: record for record in report["imports"]}
    assert by_work["strongsgreek"]["statistics"]["lexicon_entries"] == 2
    assert by_work["strongsgreek"]["lexicon_diagnostics"]["skipped_stubs"] == 1
    assert by_work["strongshebrew"]["statistics"]["lexicon_entries"] == 3
    conn = sqlite3.connect(out)
    assert conn.execute("SELECT count(*) FROM strong_lexicon").fetchone()[0] == 5


def test_every_shipped_work_is_declared_in_notice_and_the_rights_matrix():
    """The one-way invariant docs/extra/content-and-licensing.md states.

    The rights matrix silently omitted Strong's Greek and Hebrew for two milestones — both
    public domain, so nothing shipped against its licence, but a table read as the complete
    answer was not complete. A doc cannot enforce that about itself, so it is asserted here
    against the work ids the CLI actually builds.
    """
    root = Path(__file__).resolve().parents[3]
    notice = (root / "NOTICE").read_text(encoding="utf-8")
    matrix = (root / "docs" / "extra" / "content-and-licensing.md").read_text(encoding="utf-8")

    # How each shipped work is named in the human-facing matrix.
    matrix_names = {
        "web": "World English Bible",
        "kjv": "King James Version",
        "mhc": "Matthew Henry",
        "easton": "Easton",
        "tsk": "TSK",
        "baptist1689": "1689 London Baptist",
        "baptist1689bg": "Баптистка",
        "strongsgreek": "Strong's Greek",
        "strongshebrew": "Strong's Hebrew",
    }
    shipped = set(cli.SOURCE_FILES) | {"baptist1689bg"}
    assert shipped == set(matrix_names), (
        "a source was added or removed without updating this test, NOTICE, and the rights matrix"
    )
    for work_id, display in sorted(matrix_names.items()):
        assert f"Work id:        {work_id}" in notice, f"{work_id} is missing from NOTICE"
        assert display in matrix, f"{work_id} is missing from the rights matrix"


def _shipped_attributions() -> dict[str, str]:
    """Every attribution literal the importer can write into works.attribution.

    Read from the source rather than by building a database: these are static literals,
    and a test that needs a 30-second build is a test that gets skipped.
    """
    import ast

    from bibleimport import cli as _cli
    from bibleimport import pipeline as _pipeline

    out: dict[str, str] = {}
    for module in (_pipeline, _cli):
        tree = ast.parse(Path(module.__file__).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            for kw in getattr(node, "keywords", []) or []:
                if kw.arg != "attribution":
                    continue
                try:
                    value = ast.literal_eval(kw.value)
                except ValueError:
                    continue  # not a plain literal; nothing to compare
                if isinstance(value, str):
                    out[value] = Path(module.__file__).name
    return out


def test_notice_quotes_every_shipped_attribution_verbatim():
    """NOTICE promises its quoted attribution strings are exactly what ships.

    They drifted once already: the TSK attribution gained a CC BY licence URI and a
    modification statement while NOTICE went on quoting the older wording, and the
    container image then carried both — two different licensing records for one work
    inside a single artifact. A promise of verbatim equality has to be mechanical, so
    this compares the literals the importer writes against NOTICE's text, normalising
    only the line wrapping NOTICE applies for readability.
    """
    notice = " ".join(
        (Path(__file__).resolve().parents[3] / "NOTICE").read_text(encoding="utf-8").split()
    )
    shipped = _shipped_attributions()
    assert len(shipped) >= 8, "attribution literals are no longer being found in the source"
    missing = [
        f"{origin}: {text}" for text, origin in shipped.items() if " ".join(text.split()) not in notice
    ]
    assert not missing, "NOTICE does not quote these shipped attributions verbatim: " + "; ".join(
        missing
    )


def test_tsk_attribution_carries_the_cc_by_licence_uri_and_modification_status():
    """CC BY 4.0 asks for a licence URI and an indication of modification.

    works.attribution is the only one of these that reaches someone holding just
    content.sqlite or the container image, so the notice has to be inside it.
    """
    tsk = next(t for t in _shipped_attributions() if t.startswith("Cross-reference data"))
    assert "https://creativecommons.org/licenses/by/4.0/" in tsk
    assert "unmodified" in tsk

