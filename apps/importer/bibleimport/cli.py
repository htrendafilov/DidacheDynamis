"""bibleimport CLI.

    bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
    bibleimport build --format usfx --work-id web --title "World English Bible" \\
        --abbrev WEB --language en --versification kjv --license "Public Domain" \\
        --attribution "..." --ai-context-policy allowed --source <path> --out data/content.sqlite
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .formats.sword_dictionary import EXPECTED_EASTON_ENTRIES
from .pipeline import (
    AlignmentExpectation,
    BibleSpec,
    BookSpec,
    LexicalSentinel,
    append_bible,
    append_book,
    append_strongs,
    append_study_content,
    build_bible,
    easton_source_version,
    source_sha256,
)
from .schema import SCHEMA_VERSION

# Canonical filenames under data/sources/ used by `build-all`.
SOURCE_FILES = {
    "web": "engwebp_usfx.zip",
    "kjv": "KJV.imp.gz",
    "mhc": "MHC.imp.gz",
    "easton": "Easton.raw.imp.gz",
    "tsk": "crossreferences_kjv.tsv",
    "baptist1689": "BaptistConfession1689-ed1.imp.gz",
    "strongsgreek": "StrongsGreek.imp.gz",
    "strongshebrew": "StrongsHebrew.imp.gz",
}

WEB_SPEC = BibleSpec(
    work_id="web",
    title="World English Bible",
    abbrev="WEB",
    language="en",
    versification="kjv",
    license="Public Domain",
    attribution=(
        'The World English Bible is in the Public Domain. '
        '"World English Bible" is a Trademark of eBible.org.'
    ),
    source_url="https://ebible.org/find/details.php?id=engwebp",
    source_version="World English Bible Updated (2023 text; eBible archive 2026-07-10)",
    ai_context_policy="allowed",
)

KJV_SPEC = BibleSpec(
    work_id="kjv",
    title="King James Version (1769)",
    abbrev="KJV",
    language="en",
    versification="kjv",
    license="CrossWire general public license; module distribution license: GPL",
    attribution=(
        "King James Version (1769), CrossWire KJV module 3.1. "
        "CrossWire grants a general public license to use its KJV2003 Project text "
        "for any purpose; module distribution license: GPL. "
        "The rights to the base text are held by the Crown of England."
    ),
    source_url="https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=KJV",
    source_version="CrossWire KJV 3.1 (2023-07-19)",
    expected_alignment=AlignmentExpectation(
        base_work_id="web",
        base_checksum="f751bc6a4663829c4912c190586d919cfad4eb38af27218cee9a85658fcf18e0",
        source_checksum="6155ed9188d3a1fcfb5e535c8f17bd72cda75c00f8828aa58e34ce213825610c",
        missing_in_other=frozenset(
            {
                ("Rom", 14, 24),
                ("Rom", 14, 25),
                ("Rom", 14, 26),
            }
        ),
        missing_in_base=frozenset(
            {
                ("Acts", 8, 37),
                ("Acts", 15, 34),
                ("Acts", 24, 7),
                ("Luke", 17, 36),
                ("Rom", 16, 25),
                ("Rom", 16, 26),
                ("Rom", 16, 27),
            }
        ),
    ),
    lexical_sentinel=LexicalSentinel(
        osis="Gen",
        chapter=1,
        verse=1,
        tagged_spans=6,
        strong_ids=7,
    ),
    ai_context_policy="allowed",
)

BAPTIST_1689_SPEC = BookSpec(
    work_id="baptist1689",
    title="The Baptist Confession of Faith of 1689",
    abbrev="1689",
    language="en",
    license="Public Domain",
    attribution=(
        "The Baptist Confession of Faith of 1689. Based on the public-domain CrossWire "
        "BaptistConfession1689 1.0.2 module, obtained from reformed.org with thanks to "
        "Ed Walsh. Obvious transcription omissions, Scripture-reference errors, and "
        "markup defects were corrected against the historical 1677 text. No doctrinal "
        "or stylistic modernization was intended. Editorial changes are recorded in "
        "the source info manifest."
    ),
    source_url=(
        "https://www.crosswire.org/ftpmirror/pub/sword/raw/mods.d/"
        "baptistconfession1689.conf"
    ),
    source_version=(
        "CrossWire BaptistConfession1689 1.0.2 + bible_app_bg editorial revision 1 "
        "(2026-07-29)"
    ),
    ai_context_policy="allowed",
)


def _report_path(args) -> Path:
    return Path(args.report) if args.report else Path(f"{args.out}.diagnostics.json")


def _audit_record(
    work_id: str,
    source: str | Path,
    *,
    result: str,
    ai_context_policy: str,
    statistics: dict | None = None,
    source_version: str | None = None,
    diagnostics=None,
) -> dict:
    path = Path(source)
    record = {
        "work_id": work_id,
        "source": path.name,
        "source_bytes": path.stat().st_size if path.exists() else None,
        "sha256": source_sha256(path) if path.is_file() else None,
        "source_version": source_version,
        "ai_context_policy": ai_context_policy,
        "result": result,
        "statistics": statistics or {},
        "warnings": list(diagnostics.warnings) if diagnostics else [],
        "errors": list(diagnostics.errors) if diagnostics else [],
        "alignment": diagnostics.alignment if diagnostics else None,
    }
    return record


def _print_audit(record: dict) -> None:
    concise = {
        key: record[key]
        for key in ("work_id", "source", "source_bytes", "sha256", "ai_context_policy", "result")
    }
    concise["statistics"] = {
        key: value for key, value in record["statistics"].items() if key != "per_book"
    }
    print(f"AUDIT {json.dumps(concise, sort_keys=True, separators=(',', ':'))}")


def _write_report(
    args,
    imports: list[dict],
    *,
    result: str,
    errors: list[str] | None = None,
) -> None:
    path = _report_path(args)
    if path.resolve() == Path(args.out).resolve():
        raise ValueError("--report must not overwrite the content database")
    payload = {
        "report_version": 1,
        "schema_version": SCHEMA_VERSION,
        "result": result,
        "output": Path(args.out).name,
        "imports": imports,
        "errors": errors or [],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)
    print(f"diagnostics={path}")


def _report(diag, audit: dict | None = None) -> int:
    s = diag.stats
    if s:
        print(f"books={s.get('books')} verses={s.get('verses')} headings={s.get('headings')}")
    for w in diag.warnings:
        print(f"  warning: {w}", file=sys.stderr)
    for e in diag.errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    if audit:
        _print_audit(audit)
    if not diag.ok:
        print("FAILED — database not written.", file=sys.stderr)
        return 1
    print("OK")
    return 0


def _cmd_build_web(args) -> int:
    diag = build_bible(args.source, WEB_SPEC, args.out, fmt="usfx")
    audit = _audit_record(
        WEB_SPEC.work_id,
        args.source,
        result="ok" if diag.ok else "failed",
        ai_context_policy=WEB_SPEC.ai_context_policy,
        statistics=diag.stats,
        source_version=WEB_SPEC.source_version,
        diagnostics=diag,
    )
    code = _report(diag, audit)
    _write_report(args, [audit], result="ok" if code == 0 else "failed")
    return code


def _cmd_build(args) -> int:
    spec = BibleSpec(
        work_id=args.work_id, title=args.title, abbrev=args.abbrev, language=args.language,
        versification=args.versification, license=args.license, attribution=args.attribution,
        ai_context_policy=args.ai_context_policy,
        source_url=args.source_url, source_version=args.source_version, direction=args.direction,
    )
    diag = build_bible(args.source, spec, args.out, fmt=args.format)
    audit = _audit_record(
        spec.work_id,
        args.source,
        result="ok" if diag.ok else "failed",
        ai_context_policy=spec.ai_context_policy,
        statistics=diag.stats,
        source_version=spec.source_version,
        diagnostics=diag,
    )
    code = _report(diag, audit)
    _write_report(args, [audit], result="ok" if code == 0 else "failed")
    return code


def _easton_audit(source: str | Path, stats: dict, easton_diag: dict) -> dict:
    statistics: dict = {"dictionary_entries": stats["dictionary_entries"]}
    if "bible_refs" in easton_diag:
        statistics["bible_refs"] = easton_diag["bible_refs"]
        statistics["easton_refs"] = easton_diag["easton_refs"]
    audit = _audit_record(
        "easton",
        source,
        result="ok",
        ai_context_policy="allowed",
        statistics=statistics,
        source_version=easton_source_version(easton_diag),
    )
    # Full per-reference detail (corrections raw+derived, unreconciled, ambiguous, missing)
    # belongs to the JSON diagnostics artifact, not the concise stdout audit line.
    audit["reference_diagnostics"] = easton_diag
    return audit


def _cmd_add_study(args) -> int:
    stats, easton_diag = append_study_content(
        args.out,
        commentary_sources=args.mhc_source,
        dictionary_source=args.easton_source,
        xref_source=args.xref_source,
        expected_dictionary_entries=EXPECTED_EASTON_ENTRIES,
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    imports = []
    for source in args.mhc_source:
        imports.append(
            _audit_record(
                "mhc",
                source,
                result="ok",
                ai_context_policy="allowed",
                statistics={"commentary_entries": stats["commentary_entries"]},
                source_version="CrossWire MHC 2.2",
            )
        )
    imports.extend(
        [
            _easton_audit(args.easton_source, stats, easton_diag),
            _audit_record(
                "tsk",
                args.xref_source,
                result="ok",
                ai_context_policy="allowed",
                statistics={"xrefs": stats["xrefs"]},
                source_version="KJV mapping",
            ),
        ]
    )
    for audit in imports:
        _print_audit(audit)
    _write_report(args, imports, result="ok")
    print("OK")
    return 0


def _cmd_add_kjv(args) -> int:
    diag = append_bible(args.source, KJV_SPEC, args.out)
    audit = _audit_record(
        KJV_SPEC.work_id,
        args.source,
        result="ok" if diag.ok else "failed",
        ai_context_policy=KJV_SPEC.ai_context_policy,
        statistics=diag.stats,
        source_version=KJV_SPEC.source_version,
        diagnostics=diag,
    )
    code = _report(diag, audit)
    _write_report(args, [audit], result="ok" if code == 0 else "failed")
    return code


def _cmd_add_book(args) -> int:
    spec = BookSpec(
        work_id=args.work_id,
        title=args.title,
        abbrev=args.abbrev,
        language=args.language,
        license=args.license,
        attribution=args.attribution,
        ai_context_policy=args.ai_context_policy,
        source_url=args.source_url,
        source_version=args.source_version,
        direction=args.direction,
    )
    count = append_book(args.source, spec, args.out)
    print(f"book_sections={count}")
    audit = _audit_record(
        spec.work_id,
        args.source,
        result="ok",
        ai_context_policy=spec.ai_context_policy,
        statistics={"book_sections": count},
        source_version=spec.source_version,
    )
    _print_audit(audit)
    _write_report(args, [audit], result="ok")
    print("OK")
    return 0


def _strongs_audits(
    greek_source: str | Path, hebrew_source: str | Path, stats: dict, diags: dict
) -> list[dict]:
    greek = _audit_record(
        "strongsgreek",
        greek_source,
        result="ok",
        ai_context_policy="allowed",
        statistics={"lexicon_entries": stats["strongs_greek_entries"]},
        source_version="CrossWire StrongsGreek 2.0",
    )
    greek["lexicon_diagnostics"] = diags["greek"]
    hebrew = _audit_record(
        "strongshebrew",
        hebrew_source,
        result="ok",
        ai_context_policy="allowed",
        statistics={"lexicon_entries": stats["strongs_hebrew_entries"]},
        source_version="CrossWire StrongsHebrew 1.2",
    )
    hebrew["lexicon_diagnostics"] = diags["hebrew"]
    return [greek, hebrew]


def _cmd_add_strongs(args) -> int:
    stats, diags = append_strongs(
        args.out,
        greek_source=args.greek_source,
        hebrew_source=args.hebrew_source,
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    imports = _strongs_audits(args.greek_source, args.hebrew_source, stats, diags)
    for audit in imports:
        _print_audit(audit)
    _write_report(args, imports, result="ok")
    print("OK")
    return 0


def _cmd_build_all(args) -> int:
    """Build the complete content DB (WEB + KJV + study library + General Books) in one step.

    This is the single source of truth for the build sequence — the Docker image and any
    rebuild use it, so deploys always match the documented content set.
    """
    src = Path(args.sources_dir)
    out = args.out
    imports: list[dict] = []
    missing: list[str] = []
    for name in SOURCE_FILES.values():
        if not (src / name).exists():
            missing.append(name)
    if missing:
        errors = [f"missing source: {name}" for name in missing]
        for error in errors:
            print(error, file=sys.stderr)
        _write_report(args, imports, result="failed", errors=errors)
        return 1

    print("==> WEB")
    diag = build_bible(src / SOURCE_FILES["web"], WEB_SPEC, out, fmt="usfx")
    audit = _audit_record(
        WEB_SPEC.work_id,
        src / SOURCE_FILES["web"],
        result="ok" if diag.ok else "failed",
        ai_context_policy=WEB_SPEC.ai_context_policy,
        statistics=diag.stats,
        source_version=WEB_SPEC.source_version,
        diagnostics=diag,
    )
    imports.append(audit)
    code = _report(diag, audit)
    if not diag.ok:
        _write_report(args, imports, result="failed")
        return code

    print("==> KJV")
    diag = append_bible(src / SOURCE_FILES["kjv"], KJV_SPEC, out)
    audit = _audit_record(
        KJV_SPEC.work_id,
        src / SOURCE_FILES["kjv"],
        result="ok" if diag.ok else "failed",
        ai_context_policy=KJV_SPEC.ai_context_policy,
        statistics=diag.stats,
        source_version=KJV_SPEC.source_version,
        diagnostics=diag,
    )
    imports.append(audit)
    code = _report(diag, audit)
    if not diag.ok:
        _write_report(args, imports, result="failed")
        return code

    print("==> study library (Matthew Henry, Easton's, TSK)")
    stats, easton_diag = append_study_content(
        out,
        commentary_sources=[src / SOURCE_FILES["mhc"]],
        dictionary_source=src / SOURCE_FILES["easton"],
        xref_source=src / SOURCE_FILES["tsk"],
        expected_dictionary_entries=EXPECTED_EASTON_ENTRIES,
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    study_imports = [
        _audit_record(
            "mhc",
            src / SOURCE_FILES["mhc"],
            result="ok",
            ai_context_policy="allowed",
            statistics={"commentary_entries": stats["commentary_entries"]},
            source_version="CrossWire MHC 2.2",
        ),
        _easton_audit(src / SOURCE_FILES["easton"], stats, easton_diag),
        _audit_record(
            "tsk",
            src / SOURCE_FILES["tsk"],
            result="ok",
            ai_context_policy="allowed",
            statistics={"xrefs": stats["xrefs"]},
            source_version="KJV mapping",
        ),
    ]
    imports.extend(study_imports)
    for audit in study_imports:
        _print_audit(audit)

    print("==> General Books (1689 Baptist Confession)")
    count = append_book(src / SOURCE_FILES["baptist1689"], BAPTIST_1689_SPEC, out)
    print(f"book_sections={count}")
    audit = _audit_record(
        BAPTIST_1689_SPEC.work_id,
        src / SOURCE_FILES["baptist1689"],
        result="ok",
        ai_context_policy=BAPTIST_1689_SPEC.ai_context_policy,
        statistics={"book_sections": count},
        source_version=BAPTIST_1689_SPEC.source_version,
    )
    imports.append(audit)
    _print_audit(audit)

    print("==> Strong's lexicons (Greek, Hebrew)")
    stats, diags = append_strongs(
        out,
        greek_source=src / SOURCE_FILES["strongsgreek"],
        hebrew_source=src / SOURCE_FILES["strongshebrew"],
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    strongs_imports = _strongs_audits(
        src / SOURCE_FILES["strongsgreek"],
        src / SOURCE_FILES["strongshebrew"],
        stats,
        diags,
    )
    imports.extend(strongs_imports)
    for audit in strongs_imports:
        _print_audit(audit)

    _write_report(args, imports, result="ok")
    print("OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="bibleimport", description="Build content.sqlite from Bible sources."
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("build-web", help="Import the World English Bible (USFX).")
    w.add_argument("--source", required=True, help="engwebp_usfx.zip or .xml")
    w.add_argument("--out", required=True, help="output content.sqlite path")
    w.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    w.set_defaults(func=_cmd_build_web)

    k = sub.add_parser("add-kjv", help="Append CrossWire's KJV 3.1 raw SWORD export.")
    k.add_argument("--source", required=True, help="KJV.imp.gz from official mod2imp")
    k.add_argument("--out", required=True, help="existing content.sqlite path")
    k.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    k.set_defaults(func=_cmd_add_kjv)

    g = sub.add_parser("add-book", help="Append a SWORD General Book IMP export.")
    g.add_argument("--source", required=True, help="mod2imp output (.imp or .imp.gz)")
    g.add_argument("--out", required=True, help="existing content.sqlite path")
    g.add_argument("--work-id", required=True)
    g.add_argument("--title", required=True)
    g.add_argument("--abbrev", required=True)
    g.add_argument("--language", required=True)
    g.add_argument("--license", required=True)
    g.add_argument("--attribution", required=True)
    g.add_argument(
        "--ai-context-policy",
        required=True,
        choices=["allowed", "allowed_no_training", "prohibited", "unknown"],
        help="may this work's text be sent to an external AI service? "
             "'allowed_no_training' requires the conditional privacy gate in the "
             "interactive chat plan. Set 'prohibited' unless the licence "
             "explicitly permits it.",
    )
    g.add_argument("--source-url", default=None)
    g.add_argument("--source-version", default=None)
    g.add_argument("--direction", default="ltr")
    g.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    g.set_defaults(func=_cmd_add_book)

    a = sub.add_parser(
        "build-all",
        help="Build the full content DB (Bibles + study library + General Books).",
    )
    a.add_argument("--sources-dir", default="data/sources", help="dir holding the source files")
    a.add_argument("--out", required=True, help="output content.sqlite path")
    a.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    a.set_defaults(func=_cmd_build_all)

    b = sub.add_parser("build", help="Import a Bible with explicit metadata.")
    b.add_argument("--format", default="usfx", choices=["usfx"])
    b.add_argument("--source", required=True)
    b.add_argument("--out", required=True)
    b.add_argument("--work-id", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--abbrev", required=True)
    b.add_argument("--language", required=True)
    b.add_argument("--versification", default="kjv")
    b.add_argument("--license", required=True)
    b.add_argument("--attribution", required=True)
    b.add_argument(
        "--ai-context-policy",
        required=True,
        choices=["allowed", "allowed_no_training", "prohibited", "unknown"],
        help="may this work's text be sent to an external AI service? "
             "'allowed_no_training' requires the conditional privacy gate in the "
             "interactive chat plan. Set 'prohibited' unless the licence "
             "explicitly permits it.",
    )
    b.add_argument("--source-url", default=None)
    b.add_argument("--source-version", default=None)
    b.add_argument("--direction", default="ltr")
    b.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    b.set_defaults(func=_cmd_build)

    s = sub.add_parser("add-study", help="Append Matthew Henry, Easton's, and TSK data.")
    s.add_argument("--out", required=True, help="existing content.sqlite path")
    s.add_argument(
        "--mhc-source", action="append", required=True, help="CrossWire IMP(.gz) or CCEL ThML"
    )
    s.add_argument(
        "--easton-source",
        required=True,
        help="CrossWire IMP(.gz): raw TEI mod2imp export, legacy stripped IMP, or CCEL ThML",
    )
    s.add_argument("--xref-source", required=True, help="TSK-derived crossreferences_kjv.tsv")
    s.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    s.set_defaults(func=_cmd_add_study)

    st = sub.add_parser(
        "add-strongs", help="Append Strong's Greek + Hebrew lexicons (M8 lexical data)."
    )
    st.add_argument(
        "--greek-source", required=True, help="StrongsGreek.imp.gz (raw mod2imp export)"
    )
    st.add_argument(
        "--hebrew-source", required=True, help="StrongsHebrew.imp.gz (raw mod2imp export)"
    )
    st.add_argument("--out", required=True, help="existing content.sqlite path")
    st.add_argument("--report", help="diagnostics JSON (default: <out>.diagnostics.json)")
    st.set_defaults(func=_cmd_add_strongs)

    args = p.parse_args(argv)
    if args.report and Path(args.report).resolve() == Path(args.out).resolve():
        p.error("--report must not overwrite the content database")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
