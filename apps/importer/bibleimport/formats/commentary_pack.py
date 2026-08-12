"""Strict adapter for the versioned commentary JSONL.gz package (M2 package v1).

The package is the canonical source for translated commentary (not LLM-regenerated IMP/OSIS).
Every imported file is untrusted: compressed/expanded byte ceilings, record-count and line
limits, nesting depth, and checksum verification apply here.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..canonical import (
    CommentaryRow,
    commentary_body_from_json,
    commentary_plain_text,
)

# Named constants next to the existing study/usfx ceilings (AGENTS.md + master plan §4.1).
_MAX_PACKAGE_COMPRESSED_BYTES = 64 * 1024 * 1024
_MAX_PACKAGE_EXPANDED_BYTES = 256 * 1024 * 1024
_MAX_COMPRESSION_RATIO = 100.0
_MAX_RECORDS = 50_000
_MAX_LINE_BYTES = 2 * 1024 * 1024
_MAX_BLOCKS_PER_RECORD = 2_000
_MAX_RUNS_PER_BLOCK = 20_000
_MAX_TEXT_BYTES_PER_BLOCK = 512 * 1024
_MAX_JSON_DEPTH = 16

_UNIT_ID = re.compile(
    r"^(?P<source>[A-Za-z0-9_-]+)/(?P<osis>[1-3]?[A-Za-z]+)/(?P<chapter>\d+)/"
    r"(?:intro|(?P<vs>\d+)-(?P<ve>\d+))/(?P<ord>\d{2,})$"
)

PACKAGE_FORMAT_VERSION = 1


@dataclass
class PackageLimits:
    max_compressed_bytes: int = _MAX_PACKAGE_COMPRESSED_BYTES
    max_expanded_bytes: int = _MAX_PACKAGE_EXPANDED_BYTES
    max_compression_ratio: float = _MAX_COMPRESSION_RATIO
    max_records: int = _MAX_RECORDS
    max_line_bytes: int = _MAX_LINE_BYTES
    max_blocks_per_record: int = _MAX_BLOCKS_PER_RECORD
    max_runs_per_block: int = _MAX_RUNS_PER_BLOCK
    max_text_bytes_per_block: int = _MAX_TEXT_BYTES_PER_BLOCK
    max_json_depth: int = _MAX_JSON_DEPTH


@dataclass
class PackageMeta:
    """Work-level metadata carried alongside the package (CLI / sidecar)."""

    work_id: str
    title: str
    abbrev: str
    language: str
    license: str
    attribution: str
    ai_context_policy: str
    release_version: str
    provenance_id: str
    source_work_id: str = "mhc"
    direction: str = "ltr"
    versification: str = "kjv"
    source_url: str | None = None
    source_version: str | None = None


@dataclass
class LoadedPackage:
    rows: list[CommentaryRow]
    package_checksum: str  # sha256 of compressed bytes
    record_count: int
    expanded_bytes: int
    block_provenance: list[tuple[str, int, str]] = field(default_factory=list)
    # (unit_id, block_index, provenance_id) for sparse overrides


def _json_depth(value: Any, depth: int = 0) -> int:
    if isinstance(value, dict):
        if not value:
            return depth + 1
        return max(_json_depth(v, depth + 1) for v in value.values())
    if isinstance(value, list):
        if not value:
            return depth + 1
        return max(_json_depth(v, depth + 1) for v in value)
    return depth


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _iter_jsonl_gz(path: Path, limits: PackageLimits) -> Iterator[tuple[int, dict]]:
    compressed = path.stat().st_size
    if compressed > limits.max_compressed_bytes:
        raise ValueError(
            f"commentary package exceeds compressed limit "
            f"({compressed} > {limits.max_compressed_bytes}): {path}"
        )
    expanded = 0
    records = 0
    with gzip.open(path, "rb") as handle:
        while True:
            line = handle.readline()
            if not line:
                break
            expanded += len(line)
            if expanded > limits.max_expanded_bytes:
                raise ValueError(
                    f"commentary package exceeds expanded limit "
                    f"({expanded} > {limits.max_expanded_bytes}): {path}"
                )
            if compressed > 0 and expanded / compressed > limits.max_compression_ratio:
                raise ValueError(
                    f"commentary package compression ratio exceeds "
                    f"{limits.max_compression_ratio}: {path}"
                )
            if len(line) > limits.max_line_bytes:
                raise ValueError(
                    f"commentary package line exceeds {limits.max_line_bytes} bytes: {path}"
                )
            stripped = line.strip()
            if not stripped:
                continue
            records += 1
            if records > limits.max_records:
                raise ValueError(
                    f"commentary package exceeds record limit {limits.max_records}: {path}"
                )
            try:
                obj = json.loads(stripped.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid JSONL record {records} in {path}: {exc}") from exc
            if _json_depth(obj) > limits.max_json_depth:
                raise ValueError(
                    f"commentary package record {records} exceeds nesting depth "
                    f"{limits.max_json_depth}: {path}"
                )
            if not isinstance(obj, dict):
                raise TypeError(f"commentary package record {records} is not an object: {path}")
            yield records, obj
    if records == 0:
        raise ValueError(f"commentary package has no records: {path}")


def _validate_coordinates(unit_id: str, osis: str, chapter: int, verse_start: int | None) -> None:
    match = _UNIT_ID.match(unit_id)
    if not match:
        raise ValueError(f"invalid unit_id shape: {unit_id!r}")
    if match.group("osis") != osis:
        raise ValueError(f"unit_id osis {match.group('osis')!r} != record osis {osis!r}")
    if int(match.group("chapter")) != chapter:
        raise ValueError(f"unit_id chapter != record chapter for {unit_id}")
    if verse_start is None:
        if match.group("vs") is not None:
            raise ValueError(f"intro unit_id expected for NULL verse: {unit_id}")
    else:
        if match.group("vs") is None:
            raise ValueError(f"verse unit_id expected for verse {verse_start}: {unit_id}")
        if int(match.group("vs")) != verse_start or int(match.group("ve")) != verse_start:
            raise ValueError(f"unit_id verse range must be key verse only: {unit_id}")


def load_commentary_package(
    path: str | Path,
    *,
    expected_checksum: str | None = None,
    limits: PackageLimits | None = None,
) -> LoadedPackage:
    """Load and validate a commentary package. Returns rows ready for append_commentary."""
    path = Path(path)
    limits = limits or PackageLimits()
    if not path.is_file():
        raise ValueError(f"commentary package not found: {path}")
    package_checksum = _sha256_file(path)
    if expected_checksum is not None and package_checksum != expected_checksum:
        raise ValueError(
            f"commentary package checksum mismatch: expected {expected_checksum}, "
            f"got {package_checksum}"
        )

    rows: list[CommentaryRow] = []
    block_provenance: list[tuple[str, int, str]] = []
    seen_unit_ids: set[str] = set()
    expanded_bytes = 0

    for _index, obj in _iter_jsonl_gz(path, limits):
        # Track expanded size roughly via re-encoding (the iterator already enforces the ceiling).
        expanded_bytes += len(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

        fmt = obj.get("format_version", PACKAGE_FORMAT_VERSION)
        if fmt != PACKAGE_FORMAT_VERSION:
            raise ValueError(f"unsupported package format_version: {fmt!r}")

        unit_id = obj.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id:
            raise TypeError("package record missing unit_id")
        if unit_id in seen_unit_ids:
            raise ValueError(f"duplicate unit_id in package: {unit_id}")
        seen_unit_ids.add(unit_id)

        osis = obj.get("osis_code") or obj.get("osis")
        chapter = obj.get("chapter")
        if not isinstance(osis, str) or not isinstance(chapter, int):
            raise TypeError(f"package record {unit_id} missing osis/chapter")
        verse_start = obj.get("verse_start")
        verse_end = obj.get("verse_end")
        if verse_start is not None and not isinstance(verse_start, int):
            raise TypeError(f"package record {unit_id} has non-int verse_start")
        if verse_end is not None and not isinstance(verse_end, int):
            raise TypeError(f"package record {unit_id} has non-int verse_end")
        if (verse_start is None) != (verse_end is None):
            raise ValueError(f"package record {unit_id}: verse_start/verse_end must both be set or both null")
        if verse_start is not None and verse_end is not None and verse_end != verse_start:
            # Key-verse coordinates only (master plan §4.2).
            raise ValueError(
                f"package record {unit_id}: verse_end must equal verse_start (key verse only)"
            )

        _validate_coordinates(unit_id, osis, chapter, verse_start)

        body_raw = obj.get("body")
        if not isinstance(body_raw, dict):
            raise TypeError(f"package record {unit_id} missing body object")
        body = commentary_body_from_json(body_raw)
        blocks = body["blocks"]
        if len(blocks) > limits.max_blocks_per_record:
            raise ValueError(f"package record {unit_id} has too many blocks")
        for block in blocks:
            text = block["text"]
            if len(text.encode("utf-8")) > limits.max_text_bytes_per_block:
                raise ValueError(f"package record {unit_id} has an oversized block text")
            runs = block.get("runs") or []
            if len(runs) > limits.max_runs_per_block:
                raise ValueError(f"package record {unit_id} has too many runs in a block")

        def _body_hash(value: dict) -> str:
            return hashlib.sha256(
                json.dumps(
                    value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode()
            ).hexdigest()

        source_hash = obj.get("source_hash")
        content_hash = obj.get("content_hash")
        computed = _body_hash(body)
        if not isinstance(source_hash, str) or not source_hash:
            source_hash = computed
        if not isinstance(content_hash, str) or not content_hash:
            content_hash = computed
        elif content_hash != computed:
            raise ValueError(f"package record {unit_id}: content_hash does not match body")

        overrides = obj.get("block_provenance") or []
        if overrides and not isinstance(overrides, list):
            raise TypeError(f"package record {unit_id}: block_provenance must be a list")
        for item in overrides:
            if not isinstance(item, dict):
                raise TypeError(f"package record {unit_id}: bad block_provenance item")
            bi = item.get("block_index")
            pid = item.get("provenance_id")
            if not isinstance(bi, int) or not isinstance(pid, str):
                raise TypeError(f"package record {unit_id}: block_provenance needs block_index + provenance_id")
            if bi < 0 or bi >= len(blocks):
                raise ValueError(f"package record {unit_id}: block_index out of range")
            block_provenance.append((unit_id, bi, pid))

        rows.append(
            CommentaryRow(
                osis=osis,
                chapter=chapter,
                verse_start=verse_start,
                verse_end=verse_end,
                body=body,
                plain_text=commentary_plain_text(body),
                unit_id=unit_id,
                source_hash=source_hash,
                content_hash=content_hash,
            )
        )

    return LoadedPackage(
        rows=rows,
        package_checksum=package_checksum,
        record_count=len(rows),
        expanded_bytes=expanded_bytes,
        block_provenance=block_provenance,
    )
