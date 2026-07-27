import json
import sqlite3
from pathlib import Path

import pytest

from bibleimport import cli
from bibleimport.cli import main

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"
FIXTURES = Path(__file__).parent / "fixtures"


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
    audit_line = next(
        line for line in capsys.readouterr().out.splitlines() if line.startswith("AUDIT ")
    )
    assert str(FIXTURE.parent) not in audit_line


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
