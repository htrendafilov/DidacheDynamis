#!/usr/bin/env python3
"""Build the reviewed 1689 Baptist Confession IMP module deterministically."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
INFO_PATH = REPO_ROOT / "data/sources/BaptistConfession1689-ed1.info.json"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _gzip_deterministically(data: bytes) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(
        filename="",
        mode="wb",
        fileobj=output,
        compresslevel=9,
        mtime=0,
    ) as archive:
        archive.write(data)
    return output.getvalue()


def build(*, check: bool) -> None:
    info = json.loads(INFO_PATH.read_text(encoding="utf-8"))
    base_path = REPO_ROOT / "data/sources" / info["base_source"]["filename"]
    output_path = REPO_ROOT / "data/sources" / info["revision"]["output_filename"]

    compressed_base = base_path.read_bytes()
    expected_base_archive = info["base_source"]["compressed_sha256"]
    if _sha256(compressed_base) != expected_base_archive:
        raise ValueError(f"unexpected compressed base checksum: {base_path}")

    base = gzip.decompress(compressed_base)
    expected_base_content = info["base_source"]["decompressed_sha256"]
    if _sha256(base) != expected_base_content:
        raise ValueError(f"unexpected decompressed base checksum: {base_path}")

    text = base.decode("utf-8")
    for correction in info["corrections"]:
        before = correction["before"]
        after = correction["after"]
        occurrences = text.count(before)
        if occurrences != 1:
            raise ValueError(
                f"{correction['id']} expected one occurrence, found {occurrences}"
            )
        text = text.replace(before, after, 1)

    revised = text.encode("utf-8")
    expected_content = info["revision"].get("decompressed_sha256")
    if expected_content and _sha256(revised) != expected_content:
        raise ValueError("revised decompressed checksum does not match info manifest")

    archive = _gzip_deterministically(revised)
    expected_archive = info["revision"].get("compressed_sha256")
    if expected_archive and _sha256(archive) != expected_archive:
        raise ValueError("revised compressed checksum does not match info manifest")

    if check:
        if not output_path.exists() or output_path.read_bytes() != archive:
            raise ValueError(f"generated module is stale: {output_path}")
    else:
        output_path.write_bytes(archive)

    print(
        f"{'verified' if check else 'wrote'} {output_path.relative_to(REPO_ROOT)} "
        f"({len(info['corrections'])} corrections, "
        f"sha256={_sha256(archive)})"
    )
    print(f"decompressed_sha256={_sha256(revised)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that the committed output matches the manifest",
    )
    args = parser.parse_args()
    build(check=args.check)


if __name__ == "__main__":
    main()
