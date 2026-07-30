#!/usr/bin/env python3
"""Build the Bulgarian 1689 Confession as an installable SWORD GenBook."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = REPO_ROOT / "data/sources/BaptistConfession1689_BG.imp"
DEFAULT_OUTPUT = REPO_ROOT / "dist/sword/BaptistConfession1689BG.swd"

MODULE_ID = "BaptistConfession1689BG"
MODULE_SLUG = "baptistconfession1689bg"
OLD_LINK_PREFIX = "BaptistConfession1689:"
NEW_LINK_PREFIX = f"{MODULE_ID}:"

CONF_TEMPLATE = """\
[{module_id}]
DataPath=./modules/genbook/rawgenbook/{module_slug}/{module_slug}
ModDrv=RawGenBook
Encoding=UTF-8
SourceType=OSIS
Description=Баптистка изповед на вярата от 1689 г.

GlobalOptionFilter=OSISFootnotes
GlobalOptionFilter=OSISScripref

TextSource=Български превод, основан на публичнодостъпния модул CrossWire BaptistConfession1689 1.0.2 и редакция 1 на bible_app_bg (2026-07-29)
DistributionLicense=CC0 1.0 Universal
CopyrightNotes=Българският превод и редакционните промени са предоставени по CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/

Lang=bg
LCSH=Confessions.Bulgarian
About=Български превод на Баптистката изповед на вярата от 1689 г. Английската основа е публично достояние. Текстът е сверен и редактиран спрямо историческия текст; пълният списък на редакциите се съхранява в проекта bible_app_bg. Българският превод и редакционните промени са предоставени по CC0 1.0 Universal.
MinimumVersion=1.8.0
SwordVersionDate=2026-07-29
History_0.1=(2026-07-29) Първа версия на този български превод и SWORD модул; CC0 1.0 Universal
Version=0.1
InstallSize={install_size}
"""


def _find_imp2gbs(explicit: Path | None) -> Path:
    candidates = [
        explicit,
        Path("/Applications/Eloquent.app/Contents/Resources/bin/imp2gbs"),
        Path.home() / "Applications/Eloquent.app/Contents/Resources/bin/imp2gbs",
    ]
    path_from_env = shutil.which("imp2gbs")
    if path_from_env:
        candidates.append(Path(path_from_env))

    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate.resolve()

    raise SystemExit(
        "imp2gbs was not found. Install Eloquent, or pass "
        "--imp2gbs /path/to/Eloquent.app/Contents/Resources/bin/imp2gbs"
    )


def _write_zip(source_root: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for source_path in sorted(
            path for path in source_root.rglob("*") if path.is_file()
        ):
            relative_path = source_path.relative_to(source_root).as_posix()
            info = zipfile.ZipInfo(relative_path, date_time=(2026, 7, 29, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source_path.read_bytes(), compresslevel=9)


def build(source: Path, output: Path, imp2gbs: Path) -> None:
    text = source.read_text(encoding="utf-8")
    internal_link_count = text.count(OLD_LINK_PREFIX)
    if internal_link_count == 0:
        raise SystemExit(f"No internal {OLD_LINK_PREFIX!r} links found in {source}")
    module_text = text.replace(OLD_LINK_PREFIX, NEW_LINK_PREFIX)

    with tempfile.TemporaryDirectory(prefix=f"{MODULE_SLUG}-") as temporary_directory:
        package_root = Path(temporary_directory)
        module_directory = package_root / "modules/genbook/rawgenbook" / MODULE_SLUG
        module_directory.mkdir(parents=True)
        module_base = module_directory / MODULE_SLUG

        temporary_imp = package_root / f"{MODULE_ID}.imp"
        temporary_imp.write_text(module_text, encoding="utf-8", newline="\n")

        subprocess.run(
            [str(imp2gbs), str(temporary_imp), "-o", str(module_base)],
            check=True,
        )

        expected_data_files = [
            module_base.with_suffix(".bdt"),
            module_base.with_suffix(".dat"),
            module_base.with_suffix(".idx"),
        ]
        missing = [path for path in expected_data_files if not path.is_file()]
        if missing:
            raise SystemExit(
                "imp2gbs did not produce the expected files: "
                + ", ".join(str(path) for path in missing)
            )

        install_size = sum(path.stat().st_size for path in expected_data_files)
        conf_directory = package_root / "mods.d"
        conf_directory.mkdir()
        conf_path = conf_directory / f"{MODULE_SLUG}.conf"
        conf_path.write_text(
            CONF_TEMPLATE.format(
                module_id=MODULE_ID,
                module_slug=MODULE_SLUG,
                install_size=install_size,
            ),
            encoding="utf-8",
            newline="\n",
        )

        temporary_imp.unlink()
        _write_zip(package_root, output)

    print(f"Built {output}")
    print(f"Internal module links updated: {internal_link_count}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--imp2gbs", type=Path)
    args = parser.parse_args()

    build(
        source=args.source.resolve(),
        output=args.output.resolve(),
        imp2gbs=_find_imp2gbs(args.imp2gbs),
    )


if __name__ == "__main__":
    main()
