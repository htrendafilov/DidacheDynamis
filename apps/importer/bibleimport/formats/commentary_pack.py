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

from ..books import BY_OSIS
from ..canonical import (
    CommentaryRow,
    commentary_body_from_json,
    commentary_plain_text,
)
from ..provenance import PROVENANCE_FIELDS, validate_provenance_metadata

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
_READ_CHUNK = 64 * 1024

_UNIT_ID = re.compile(
    r"^(?P<source>[A-Za-z0-9_-]+)/(?P<osis>[1-3]?[A-Za-z]+)/(?P<chapter>\d+)/"
    r"(?:intro|(?P<vs>\d+)-(?P<ve>\d+))/(?P<ord>\d{2,})$"
)
_SHA256 = re.compile(r"^[0-9a-f]{64}$")

PACKAGE_FORMAT_VERSION = 1
_COVERAGE_STATES = frozenset({"queued", "in_progress", "mt_complete"})


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


@dataclass(frozen=True)
class ProvenanceRecord:
    """Full producer identity; block overrides must supply a complete record, not a bare id."""

    provenance_id: str
    model_canonical_slug: str | None = None
    model_returned: str | None = None
    model_request_id: str | None = None
    prompt_hash: str | None = None
    glossary_hash: str | None = None
    settings_json: str | None = None
    run_id: str | None = None
    translated_at: str | None = None

    def as_tuple(self) -> tuple:
        return (
            self.provenance_id,
            self.model_request_id,
            self.model_canonical_slug,
            self.model_returned,
            self.prompt_hash,
            self.glossary_hash,
            self.settings_json,
            self.run_id,
            self.translated_at,
        )


@dataclass(frozen=True)
class BookCoverageHint:
    """Optional per-book coverage declared in package_meta (never invented by the importer)."""

    source_units: int
    excluded_units: int = 0
    state: str | None = None  # if set, must be a valid coverage state


@dataclass(frozen=True)
class ReviewRecord:
    """An owner action bound to the exact commentary text that was read or corrected."""

    unit_id: str
    content_hash: str
    reviewed_at: str
    kind: str


@dataclass
class LoadedPackage:
    rows: list[CommentaryRow]
    package_checksum: str  # sha256 of compressed bytes
    record_count: int
    expanded_bytes: int
    # Sparse block overrides: (unit_id, block_index, full ProvenanceRecord)
    block_provenance: list[tuple[str, int, ProvenanceRecord]] = field(default_factory=list)
    # Provenances declared in package_meta (must include every id used as entry default or override)
    provenances: dict[str, ProvenanceRecord] = field(default_factory=dict)
    # Per-book coverage hints from package_meta
    coverage: dict[str, BookCoverageHint] = field(default_factory=dict)
    reviews: list[ReviewRecord] = field(default_factory=list)
    quality_label: str | None = None


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


def _body_hash(value: dict) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def _parse_provenance(raw: Any, *, where: str) -> ProvenanceRecord:
    if not isinstance(raw, dict):
        raise TypeError(f"{where}: provenance must be an object")
    pid = raw.get("provenance_id")
    if not isinstance(pid, str) or not pid:
        raise ValueError(f"{where}: provenance_id is required")
    fields = {field: raw.get(field) for field in PROVENANCE_FIELDS}
    validate_provenance_metadata(pid, fields, where=where)
    return ProvenanceRecord(
        provenance_id=pid,
        model_canonical_slug=fields["model_canonical_slug"],
        model_returned=fields["model_returned"],
        model_request_id=fields["model_request_id"],
        prompt_hash=fields["prompt_hash"],
        glossary_hash=fields["glossary_hash"],
        settings_json=fields["settings_json"],
        run_id=fields["run_id"],
        translated_at=fields["translated_at"],
    )


def _iter_jsonl_gz(path: Path, limits: PackageLimits) -> Iterator[tuple[int, dict, int]]:
    """Yield (record_index, object, expanded_bytes_so_far).

    Expanded-byte, ratio, and line ceilings are enforced while reading — never after a full
    unbounded readline into memory (§4.1 / AGENTS.md decompression-bomb rules).
    """
    compressed = path.stat().st_size
    if compressed > limits.max_compressed_bytes:
        raise ValueError(
            f"commentary package exceeds compressed limit "
            f"({compressed} > {limits.max_compressed_bytes}): {path}"
        )
    expanded = 0
    records = 0
    buf = b""
    with gzip.open(path, "rb") as handle:
        while True:
            chunk = handle.read(_READ_CHUNK)
            if not chunk:
                break
            expanded += len(chunk)
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
            buf += chunk
            while True:
                nl = buf.find(b"\n")
                if nl < 0:
                    if len(buf) > limits.max_line_bytes:
                        raise ValueError(
                            f"commentary package line exceeds {limits.max_line_bytes} bytes: {path}"
                        )
                    break
                line, buf = buf[: nl + 1], buf[nl + 1 :]
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
                yield records, obj, expanded
        trailing = buf.strip()
        if trailing:
            if len(buf) > limits.max_line_bytes:
                raise ValueError(
                    f"commentary package line exceeds {limits.max_line_bytes} bytes: {path}"
                )
            records += 1
            if records > limits.max_records:
                raise ValueError(
                    f"commentary package exceeds record limit {limits.max_records}: {path}"
                )
            try:
                obj = json.loads(trailing.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid JSONL record {records} in {path}: {exc}") from exc
            if _json_depth(obj) > limits.max_json_depth:
                raise ValueError(
                    f"commentary package record {records} exceeds nesting depth "
                    f"{limits.max_json_depth}: {path}"
                )
            if not isinstance(obj, dict):
                raise TypeError(f"commentary package record {records} is not an object: {path}")
            yield records, obj, expanded
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
    if int(match.group("ord")) < 1:
        raise ValueError(f"unit_id ordinal must be positive: {unit_id}")
    if verse_start is None:
        if match.group("vs") is not None:
            raise ValueError(f"intro unit_id expected for NULL verse: {unit_id}")
    else:
        if match.group("vs") is None:
            raise ValueError(f"verse unit_id expected for verse {verse_start}: {unit_id}")
        if int(match.group("vs")) != verse_start or int(match.group("ve")) != verse_start:
            raise ValueError(f"unit_id verse range must be key verse only: {unit_id}")


def _parse_package_meta(
    obj: dict,
) -> tuple[
    dict[str, ProvenanceRecord],
    dict[str, BookCoverageHint],
    list[ReviewRecord],
    str | None,
]:
    provenances: dict[str, ProvenanceRecord] = {}
    raw_provenances = obj.get("provenances") or []
    if not isinstance(raw_provenances, list):
        raise TypeError("package_meta.provenances must be a list")
    for item in raw_provenances:
        rec = _parse_provenance(item, where="package_meta.provenances")
        if rec.provenance_id in provenances:
            raise ValueError(f"duplicate provenance_id in package_meta: {rec.provenance_id}")
        provenances[rec.provenance_id] = rec
    coverage: dict[str, BookCoverageHint] = {}
    raw_cov = obj.get("coverage") or {}
    if raw_cov and not isinstance(raw_cov, dict):
        raise TypeError("package_meta.coverage must be an object")
    for osis, hint in raw_cov.items():
        if not isinstance(osis, str) or not isinstance(hint, dict):
            raise TypeError("package_meta.coverage entries must map osis -> object")
        if osis not in BY_OSIS:
            raise ValueError(f"package_meta.coverage has non-canonical book: {osis!r}")
        su = hint.get("source_units")
        eu = hint.get("excluded_units", 0)
        state = hint.get("state")
        if type(su) is not int or su < 0:
            raise ValueError(
                f"package_meta.coverage[{osis}].source_units must be a non-negative int"
            )
        if type(eu) is not int or eu < 0:
            raise ValueError(
                f"package_meta.coverage[{osis}].excluded_units must be a non-negative int"
            )
        if eu > su:
            raise ValueError(f"package_meta.coverage[{osis}].excluded_units exceeds source_units")
        if state is not None and state not in _COVERAGE_STATES:
            raise ValueError(f"package_meta.coverage[{osis}].state invalid: {state!r}")
        coverage[osis] = BookCoverageHint(source_units=su, excluded_units=eu, state=state)
    reviews: list[ReviewRecord] = []
    seen_reviews: set[tuple[str, str, str]] = set()
    raw_reviews = obj.get("reviews") or []
    if not isinstance(raw_reviews, list):
        raise TypeError("package_meta.reviews must be a list")
    for item in raw_reviews:
        if not isinstance(item, dict):
            raise TypeError("package_meta.reviews items must be objects")
        unit_id = item.get("unit_id")
        content_hash = item.get("content_hash")
        reviewed_at = item.get("reviewed_at")
        kind = item.get("kind")
        if not isinstance(unit_id, str) or not unit_id:
            raise ValueError("package_meta review unit_id is required")
        if not isinstance(content_hash, str) or not _SHA256.fullmatch(content_hash):
            raise ValueError("package_meta review content_hash must be a lowercase sha256")
        if not isinstance(reviewed_at, str) or not reviewed_at:
            raise ValueError("package_meta review reviewed_at is required")
        if kind not in {"spot_read", "correction_authored"}:
            raise ValueError(f"package_meta review kind is invalid: {kind!r}")
        key = (unit_id, content_hash, kind)
        if key in seen_reviews:
            raise ValueError(f"duplicate package_meta review: {unit_id} {kind}")
        seen_reviews.add(key)
        reviews.append(
            ReviewRecord(
                unit_id=unit_id,
                content_hash=content_hash,
                reviewed_at=reviewed_at,
                kind=kind,
            )
        )
    quality = obj.get("quality_label")
    if quality is not None and (not isinstance(quality, str) or not quality):
        raise TypeError("package_meta.quality_label must be a non-empty string")
    return provenances, coverage, reviews, quality


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
    block_provenance: list[tuple[str, int, ProvenanceRecord]] = []
    seen_unit_ids: set[str] = set()
    expanded_bytes = 0
    provenances: dict[str, ProvenanceRecord] = {}
    coverage: dict[str, BookCoverageHint] = {}
    reviews: list[ReviewRecord] = []
    quality_label: str | None = None
    entry_records = 0
    saw_meta = False
    seen_block_overrides: set[tuple[str, int]] = set()

    for _index, obj, expanded_bytes in _iter_jsonl_gz(path, limits):
        if obj.get("type") == "package_meta":
            if saw_meta:
                raise ValueError("commentary package has more than one package_meta record")
            if entry_records:
                raise ValueError("package_meta must appear before entry records")
            provenances, coverage, reviews, quality_label = _parse_package_meta(obj)
            saw_meta = True
            continue

        entry_records += 1
        if "format_version" not in obj:
            raise ValueError("package entry record missing required format_version")
        fmt = obj["format_version"]
        if type(fmt) is not int or fmt != PACKAGE_FORMAT_VERSION:
            raise ValueError(f"unsupported package format_version: {fmt!r}")

        unit_id = obj.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id:
            raise TypeError("package record missing unit_id string")
        if unit_id in seen_unit_ids:
            raise ValueError(f"duplicate unit_id in package: {unit_id}")
        seen_unit_ids.add(unit_id)

        osis = obj.get("osis_code") or obj.get("osis")
        chapter = obj.get("chapter")
        if not isinstance(osis, str) or type(chapter) is not int:
            raise TypeError(f"package record {unit_id} missing osis/chapter")
        if osis not in BY_OSIS:
            raise ValueError(f"package record {unit_id} has non-canonical osis {osis!r}")
        if chapter < 1:
            raise ValueError(f"package record {unit_id} chapter must be positive")
        verse_start = obj.get("verse_start")
        verse_end = obj.get("verse_end")
        if verse_start is not None and type(verse_start) is not int:
            raise TypeError(f"package record {unit_id} has non-int verse_start")
        if verse_end is not None and type(verse_end) is not int:
            raise TypeError(f"package record {unit_id} has non-int verse_end")
        if (verse_start is None) != (verse_end is None):
            raise ValueError(
                f"package record {unit_id}: verse_start/verse_end must both be set or both null"
            )
        if verse_start is not None and verse_end is not None and verse_end != verse_start:
            raise ValueError(
                f"package record {unit_id}: verse_end must equal verse_start (key verse only)"
            )
        if verse_start is not None and verse_start < 1:
            raise ValueError(f"package record {unit_id}: key verse must be positive")

        _validate_coordinates(unit_id, osis, chapter, verse_start)

        body_raw = obj.get("body")
        if not isinstance(body_raw, dict):
            raise TypeError(f"package record {unit_id} missing body object")
        # Strict CIR: exact text == concat(runs.t) (no whitespace folding).
        body = commentary_body_from_json(body_raw, strict_runs=True)
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

        source_hash = obj.get("source_hash")
        content_hash = obj.get("content_hash")
        if not isinstance(source_hash, str) or not _SHA256.fullmatch(source_hash):
            raise ValueError(f"package record {unit_id}: source_hash must be a lowercase sha256")
        if not isinstance(content_hash, str) or not _SHA256.fullmatch(content_hash):
            raise ValueError(f"package record {unit_id}: content_hash must be a lowercase sha256")
        computed = _body_hash(body)
        if content_hash != computed:
            raise ValueError(f"package record {unit_id}: content_hash does not match body")

        qa_status = obj.get("qa_status")
        if not isinstance(qa_status, str) or not qa_status:
            raise ValueError(f"package record {unit_id}: qa_status is required")
        correction_revision = obj.get("correction_revision")
        if type(correction_revision) is not int or correction_revision < 0:
            raise ValueError(
                f"package record {unit_id}: correction_revision must be a non-negative int"
            )

        default_pid = obj.get("provenance_id")
        if not isinstance(default_pid, str) or not default_pid:
            raise ValueError(f"package record {unit_id}: provenance_id is required")
        if provenances and default_pid not in provenances:
            raise ValueError(
                f"package record {unit_id}: provenance_id {default_pid!r} "
                f"not declared in package_meta.provenances"
            )

        overrides = obj.get("block_provenance") or []
        if overrides and not isinstance(overrides, list):
            raise TypeError(f"package record {unit_id}: block_provenance must be a list")
        for item in overrides:
            if not isinstance(item, dict):
                raise TypeError(f"package record {unit_id}: bad block_provenance item")
            bi = item.get("block_index")
            if not isinstance(bi, int):
                raise TypeError(f"package record {unit_id}: block_index must be int")
            if bi < 0 or bi >= len(blocks):
                raise ValueError(f"package record {unit_id}: block_index out of range")
            override_key = (unit_id, bi)
            if override_key in seen_block_overrides:
                raise ValueError(f"package record {unit_id}: duplicate provenance for block {bi}")
            seen_block_overrides.add(override_key)
            # Full provenance object required — bare id is refused.
            if "provenance" in item:
                rec = _parse_provenance(item["provenance"], where=f"{unit_id}.block_provenance")
            elif "provenance_id" in item and isinstance(item["provenance_id"], str):
                pid = item["provenance_id"]
                if pid not in provenances:
                    raise ValueError(
                        f"package record {unit_id}: block provenance_id {pid!r} "
                        f"not declared in package_meta.provenances with full metadata"
                    )
                rec = provenances[pid]
            else:
                raise ValueError(
                    f"package record {unit_id}: block_provenance requires a full provenance "
                    f"object or a provenance_id declared in package_meta"
                )
            if provenances and rec.provenance_id not in provenances:
                # Inline full provenance is allowed; register it.
                provenances[rec.provenance_id] = rec
            elif rec.provenance_id in provenances and provenances[rec.provenance_id] != rec:
                raise ValueError(
                    f"provenance_id {rec.provenance_id!r} redeclared with different metadata"
                )
            elif rec.provenance_id not in provenances:
                provenances[rec.provenance_id] = rec
            block_provenance.append((unit_id, bi, rec))

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
                provenance_id=default_pid,
            )
        )

    if not rows:
        raise ValueError(f"commentary package has no entry records: {path}")
    package_books = {row.osis for row in rows}
    if len(package_books) != 1:
        raise ValueError(
            "commentary package v1 is one per-book artifact; found entries for "
            + ", ".join(sorted(package_books))
        )

    return LoadedPackage(
        rows=rows,
        package_checksum=package_checksum,
        record_count=len(rows),
        expanded_bytes=expanded_bytes,
        block_provenance=block_provenance,
        provenances=provenances,
        coverage=coverage,
        reviews=reviews,
        quality_label=quality_label,
    )
