import json
from pathlib import Path

import pytest

from bibleimport.cli import main

FIXTURE = Path(__file__).parent / "fixtures" / "mini_usfx.xml"


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
