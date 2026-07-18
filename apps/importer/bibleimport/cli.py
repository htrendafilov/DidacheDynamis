"""bibleimport CLI.

    bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
    bibleimport build --format usfx --work-id web --title "World English Bible" \\
        --abbrev WEB --language en --versification kjv --license "Public Domain" \\
        --attribution "..." --source <path> --out data/content.sqlite
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .pipeline import BibleSpec, append_bible, append_study_content, build_bible

# Canonical filenames under data/sources/ used by `build-all`.
SOURCE_FILES = {
    "web": "engwebp_usfx.zip",
    "kjv": "KJV.imp.gz",
    "mhc": "MHC.imp.gz",
    "easton": "Easton.imp.gz",
    "tsk": "crossreferences_kjv.tsv",
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
)


def _report(diag) -> int:
    s = diag.stats
    if s:
        print(f"books={s.get('books')} verses={s.get('verses')} headings={s.get('headings')}")
    for w in diag.warnings:
        print(f"  warning: {w}", file=sys.stderr)
    for e in diag.errors:
        print(f"  ERROR: {e}", file=sys.stderr)
    if not diag.ok:
        print("FAILED — database not written.", file=sys.stderr)
        return 1
    print("OK")
    return 0


def _cmd_build_web(args) -> int:
    diag = build_bible(args.source, WEB_SPEC, args.out, fmt="usfx")
    return _report(diag)


def _cmd_build(args) -> int:
    spec = BibleSpec(
        work_id=args.work_id, title=args.title, abbrev=args.abbrev, language=args.language,
        versification=args.versification, license=args.license, attribution=args.attribution,
        source_url=args.source_url, source_version=args.source_version, direction=args.direction,
    )
    diag = build_bible(args.source, spec, args.out, fmt=args.format)
    return _report(diag)


def _cmd_add_study(args) -> int:
    stats = append_study_content(
        args.out,
        commentary_sources=args.mhc_source,
        dictionary_source=args.easton_source,
        xref_source=args.xref_source,
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    print("OK")
    return 0


def _cmd_add_kjv(args) -> int:
    diag = append_bible(args.source, KJV_SPEC, args.out)
    return _report(diag)


def _cmd_build_all(args) -> int:
    """Build the complete content DB (WEB + KJV + study library) in one step.

    This is the single source of truth for the build sequence — the Docker image and any
    rebuild use it, so deploys always match the documented content set.
    """
    src = Path(args.sources_dir)
    out = args.out
    for name in SOURCE_FILES.values():
        if not (src / name).exists():
            print(f"missing source: {src / name}", file=sys.stderr)
            return 1

    print("==> WEB")
    diag = build_bible(src / SOURCE_FILES["web"], WEB_SPEC, out, fmt="usfx")
    if not diag.ok:
        return _report(diag)
    print("==> KJV")
    diag = append_bible(src / SOURCE_FILES["kjv"], KJV_SPEC, out)
    if not diag.ok:
        return _report(diag)
    print("==> study library (Matthew Henry, Easton's, TSK)")
    stats = append_study_content(
        out,
        commentary_sources=[src / SOURCE_FILES["mhc"]],
        dictionary_source=src / SOURCE_FILES["easton"],
        xref_source=src / SOURCE_FILES["tsk"],
    )
    print(" ".join(f"{key}={value}" for key, value in stats.items()))
    print("OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bibleimport", description="Build content.sqlite from Bible sources.")
    sub = p.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("build-web", help="Import the World English Bible (USFX).")
    w.add_argument("--source", required=True, help="engwebp_usfx.zip or .xml")
    w.add_argument("--out", required=True, help="output content.sqlite path")
    w.set_defaults(func=_cmd_build_web)

    k = sub.add_parser("add-kjv", help="Append CrossWire's KJV 3.1 raw SWORD export.")
    k.add_argument("--source", required=True, help="KJV.imp.gz from official mod2imp")
    k.add_argument("--out", required=True, help="existing content.sqlite path")
    k.set_defaults(func=_cmd_add_kjv)

    a = sub.add_parser(
        "build-all", help="Build the full content DB (WEB + KJV + Matthew Henry + Easton's + TSK)."
    )
    a.add_argument("--sources-dir", default="data/sources", help="dir holding the source files")
    a.add_argument("--out", required=True, help="output content.sqlite path")
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
    b.add_argument("--source-url", default=None)
    b.add_argument("--source-version", default=None)
    b.add_argument("--direction", default="ltr")
    b.set_defaults(func=_cmd_build)

    s = sub.add_parser("add-study", help="Append Matthew Henry, Easton's, and TSK data.")
    s.add_argument("--out", required=True, help="existing content.sqlite path")
    s.add_argument(
        "--mhc-source", action="append", required=True, help="CrossWire IMP(.gz) or CCEL ThML"
    )
    s.add_argument(
        "--easton-source", required=True, help="CrossWire IMP(.gz) or CCEL ThML"
    )
    s.add_argument("--xref-source", required=True, help="TSK-derived crossreferences_kjv.tsv")
    s.set_defaults(func=_cmd_add_study)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
