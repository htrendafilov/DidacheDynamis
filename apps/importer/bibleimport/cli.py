"""bibleimport CLI.

    bibleimport build-web --source data/sources/engwebp_usfx.zip --out data/content.sqlite
    bibleimport build --format usfx --work-id web --title "World English Bible" \\
        --abbrev WEB --language en --versification kjv --license "Public Domain" \\
        --attribution "..." --source <path> --out data/content.sqlite
"""

from __future__ import annotations

import argparse
import sys

from .pipeline import BibleSpec, build_bible

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


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bibleimport", description="Build content.sqlite from Bible sources.")
    sub = p.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("build-web", help="Import the World English Bible (USFX).")
    w.add_argument("--source", required=True, help="engwebp_usfx.zip or .xml")
    w.add_argument("--out", required=True, help="output content.sqlite path")
    w.set_defaults(func=_cmd_build_web)

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

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
