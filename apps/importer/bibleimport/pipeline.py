"""Build orchestration: parse a source -> validate -> write content.sqlite (+ FTS)."""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from .books import BY_OSIS
from .canonical import (
    BookMeta,
    HeadingRow,
    TokenRow,
    VerseRow,
    WorkMeta,
    make_commentary_unit_id,
    normalize_lexical_search,
)
from .formats import (
    commentary_pack,
    genbook,
    strongs_lexicon,
    study,
    sword_bible,
    sword_dictionary,
    usfx,
)
from .provenance import validate_provenance_metadata
from .schema import create_schema
from .validation import Diagnostics, align_versification, validate

VerseRef = tuple[str, int, int]


@dataclass(frozen=True)
class AlignmentExpectation:
    """Reviewed differences between an appended Bible and its base translation."""

    base_work_id: str | None = None
    base_checksum: str | None = None
    source_checksum: str | None = None
    missing_in_other: frozenset[VerseRef] = frozenset()
    missing_in_base: frozenset[VerseRef] = frozenset()


@dataclass(frozen=True)
class LexicalSentinel:
    """Known lexical row counts tied to a reviewed Bible source."""

    osis: str
    chapter: int
    verse: int
    tagged_spans: int
    strong_ids: int


@dataclass
class BibleSpec:
    work_id: str
    title: str
    abbrev: str
    language: str
    versification: str
    license: str
    attribution: str
    ai_context_policy: str  # allowed | allowed_no_training | prohibited | unknown
    source_url: str | None = None
    source_version: str | None = None
    direction: str = "ltr"
    expected_alignment: AlignmentExpectation | None = None
    lexical_sentinel: LexicalSentinel | None = None
    # True when the source file is produced by a build step rather than committed. Such a
    # source is identified by its decompressed content, never by the bytes of its container:
    # gzip output is implementation-defined — Apple gzip and GNU gzip compress the identical
    # KJV export to different bytes — so hashing the file would tie the reviewed checksum,
    # and every works.checksum and content_version derived from it, to whichever gzip built
    # it. The content hash is the same number on every machine.
    source_is_generated: bool = False


@dataclass
class BookSpec:
    work_id: str
    title: str
    abbrev: str
    language: str
    license: str
    attribution: str
    ai_context_policy: str  # allowed | allowed_no_training | prohibited | unknown
    source_url: str | None = None
    source_version: str | None = None
    direction: str = "ltr"


@dataclass
class CommentarySpec:
    """Metadata for a single generic commentary work (`add-commentary`)."""

    work_id: str
    title: str
    abbrev: str
    language: str
    license: str
    attribution: str
    ai_context_policy: str  # allowed | allowed_no_training | prohibited | unknown
    release_version: str
    provenance_id: str
    source_work_id: str = "mhc"
    source_url: str | None = None
    source_version: str | None = None
    direction: str = "ltr"
    versification: str = "kjv"
    # Production provenance details (optional for source re-imports).
    model_canonical_slug: str | None = None
    model_returned: str | None = None
    prompt_hash: str | None = None
    glossary_hash: str | None = None
    settings_json: str | None = None
    run_id: str | None = None
    translated_at: str | None = None
    model_request_id: str | None = None
    quality_label: str | None = None


def source_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_content_sha256(path: Path) -> str:
    """SHA-256 of a gzipped source's decompressed content, for generated build inputs."""
    h = hashlib.sha256()
    with gzip.open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _combined_sha256(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for path in paths:
        h.update(path.name.encode())
        h.update(bytes.fromhex(source_sha256(path)))
    return h.hexdigest()


def _insert_work(conn: sqlite3.Connection, meta: WorkMeta, *, quality_label: str | None = None) -> None:
    conn.execute(
        "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
        "license,attribution,source_url,source_version,checksum,ai_context_policy,quality_label) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            meta.id,
            meta.type,
            meta.language,
            meta.title,
            meta.abbrev,
            meta.direction,
            meta.versification,
            meta.license,
            meta.attribution,
            meta.source_url,
            meta.source_version,
            meta.checksum,
            meta.ai_context_policy,
            quality_label,
        ),
    )


def _ensure_provenance(
    conn: sqlite3.Connection,
    provenance_id: str,
    *,
    model_canonical_slug: str | None = None,
    model_returned: str | None = None,
    prompt_hash: str | None = None,
    glossary_hash: str | None = None,
    settings_json: str | None = None,
    run_id: str | None = None,
    translated_at: str | None = None,
    model_request_id: str | None = None,
) -> None:
    """Insert provenance, or refuse if the id already exists with different metadata.

    Never creates empty stub rows for unknown ids, and never silently ignores a conflicting
    re-declaration (INSERT OR IGNORE would falsify mixed-model attribution).
    """
    row = conn.execute(
        "SELECT model_request_id, model_canonical_slug, model_returned, prompt_hash, "
        "glossary_hash, settings_json, run_id, translated_at "
        "FROM translation_provenance WHERE provenance_id=?",
        (provenance_id,),
    ).fetchone()
    wanted = (
        model_request_id,
        model_canonical_slug,
        model_returned,
        prompt_hash,
        glossary_hash,
        settings_json,
        run_id,
        translated_at,
    )
    validate_provenance_metadata(
        provenance_id,
        {
            "model_request_id": model_request_id,
            "model_canonical_slug": model_canonical_slug,
            "model_returned": model_returned,
            "prompt_hash": prompt_hash,
            "glossary_hash": glossary_hash,
            "settings_json": settings_json,
            "run_id": run_id,
            "translated_at": translated_at,
        },
        where="translation_provenance",
    )
    if row is not None:
        existing = tuple(row)
        if existing != wanted:
            raise ValueError(
                f"provenance_id {provenance_id!r} already exists with different metadata"
            )
        return
    conn.execute(
        "INSERT INTO translation_provenance("
        "provenance_id, model_request_id, model_canonical_slug, model_returned, "
        "prompt_hash, glossary_hash, settings_json, run_id, translated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (provenance_id, *wanted),
    )


def _release_manifest_checksum(conn: sqlite3.Connection, work_id: str, release_version: str) -> str:
    """Hash over ordered (osis_code, package_checksum) rows for a release (M2 §4.3)."""
    rows = conn.execute(
        "SELECT osis_code, package_checksum FROM commentary_release_packages "
        "WHERE work_id=? AND release_version=? ORDER BY osis_code",
        (work_id, release_version),
    ).fetchall()
    h = hashlib.sha256()
    for osis, checksum in rows:
        h.update(osis.encode())
        h.update(b"\0")
        h.update(checksum.encode())
        h.update(b"\n")
    return h.hexdigest()


def _work_release_checksum(release_version: str, manifest_checksum: str) -> str:
    """Hash the current release identity used by API content-version calculation."""
    h = hashlib.sha256()
    h.update(release_version.encode())
    h.update(b"\0")
    h.update(manifest_checksum.encode())
    return h.hexdigest()


def _recompute_coverage_for_books(
    conn: sqlite3.Connection,
    *,
    work_id: str,
    source_work_id: str,
    release_version: str,
    osis_codes: set[str],
    coverage_hints: dict | None = None,
) -> None:
    """Derive honest coverage from DB rows and an audited source-unit baseline."""
    from .books import BY_OSIS
    from .formats.commentary_pack import BookCoverageHint

    hints: dict[str, BookCoverageHint] = coverage_hints or {}
    for osis in sorted(osis_codes, key=lambda o: BY_OSIS[o].order if o in BY_OSIS else 999):
        translated = conn.execute(
            "SELECT COUNT(*) FROM commentary_entries WHERE work_id=? AND osis_code=?",
            (work_id, osis),
        ).fetchone()[0]
        reviewed = conn.execute(
            "SELECT COUNT(DISTINCT r.unit_id) FROM commentary_reviews r "
            "JOIN commentary_entries e ON e.work_id=r.work_id AND e.unit_id=r.unit_id "
            "WHERE r.work_id=? AND e.osis_code=? AND r.kind='spot_read' "
            "AND r.content_hash=e.content_hash",
            (work_id, osis),
        ).fetchone()[0]
        prev = conn.execute(
            "SELECT source_units, excluded_units, state FROM commentary_coverage "
            "WHERE work_id=? AND osis_code=?",
            (work_id, osis),
        ).fetchone()
        hint = hints.get(osis)
        if hint is not None:
            source_units = hint.source_units
            excluded_units = hint.excluded_units
            state = hint.state
            if prev is not None and source_units != prev[0]:
                raise ValueError(
                    f"coverage source_units changed for {work_id}/{osis}: "
                    f"{prev[0]} -> {source_units}; source revisions require an explicit migration"
                )
        else:
            if prev is None:
                raise ValueError(
                    f"coverage metadata is required for first import of {work_id}/{osis}"
                )
            source_units = prev[0]
            excluded_units = prev[1]
            state = prev[2]

        accounted = translated + excluded_units
        if accounted > source_units:
            raise ValueError(
                f"coverage over-count for {work_id}/{osis}: "
                f"translated {translated} + excluded {excluded_units} > source {source_units}"
            )
        if state == "mt_complete" and accounted != source_units:
            raise ValueError(
                f"coverage cannot mark {work_id}/{osis} mt_complete: "
                f"{accounted} of {source_units} source units are accounted for"
            )
        if state == "queued" and translated:
            raise ValueError(
                f"coverage cannot mark {work_id}/{osis} queued with {translated} translated units"
            )

        if state is None:
            if source_units > 0 and accounted == source_units:
                state = "mt_complete"
            elif translated > 0:
                state = "in_progress"
            else:
                state = "queued"

        if osis in BY_OSIS:
            existing_book = conn.execute(
                "SELECT 1 FROM books WHERE work_id=? AND osis_code=?",
                (work_id, osis),
            ).fetchone()
            if existing_book is None:
                source_book = conn.execute(
                    "SELECT name, sort_order, chapter_count FROM books "
                    "WHERE osis_code=? "
                    "ORDER BY CASE WHEN work_id=? THEN 0 ELSE 1 END, sort_order LIMIT 1",
                    (osis, source_work_id),
                ).fetchone()
                if source_book is not None:
                    name, sort_order, chapters = source_book
                else:
                    name = BY_OSIS[osis].name_en
                    sort_order = BY_OSIS[osis].order
                    chapters = conn.execute(
                        "SELECT COALESCE(MAX(chapter), 0) FROM commentary_entries "
                        "WHERE work_id=? AND osis_code=?",
                        (work_id, osis),
                    ).fetchone()[0]
                conn.execute(
                    "INSERT INTO books(work_id,osis_code,name,sort_order,chapter_count) "
                    "VALUES(?,?,?,?,?)",
                    (work_id, osis, name, sort_order, chapters),
                )

        conn.execute(
            "INSERT INTO commentary_coverage("
            "work_id,osis_code,state,source_units,translated_units,excluded_units,"
            "reviewed_units,release_version) VALUES(?,?,?,?,?,?,?,?) "
            "ON CONFLICT(work_id, osis_code) DO UPDATE SET "
            "state=excluded.state, "
            "source_units=excluded.source_units, "
            "translated_units=excluded.translated_units, "
            "excluded_units=excluded.excluded_units, "
            "reviewed_units=excluded.reviewed_units, "
            "release_version=excluded.release_version",
            (
                work_id,
                osis,
                state,
                source_units,
                translated,
                excluded_units,
                reviewed,
                release_version,
            ),
        )


def _insert_commentary_rows(
    conn: sqlite3.Connection,
    *,
    work_id: str,
    source_work_id: str,
    rows: list,
    provenance_id: str,
    release_version: str,
    block_provenance: list[tuple[str, int, str]] | None = None,
) -> None:
    """Insert commentary rows with per-work entry_id, unit_id, hashes, and FTS."""
    from collections import Counter

    from .books import BY_OSIS

    ordinals: Counter[tuple[str, int, int | None]] = Counter()
    indexed: list[tuple[int, object]] = []
    for entry_id, row in enumerate(rows, start=1):
        key = (row.osis, row.chapter, row.verse_start)
        ordinals[key] += 1
        ordinal = ordinals[key]
        unit_id = row.unit_id or make_commentary_unit_id(
            source_work_id, row.osis, row.chapter, row.verse_start, ordinal
        )
        body_json = json.dumps(row.body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        content_hash = row.content_hash or hashlib.sha256(body_json.encode()).hexdigest()
        source_hash = row.source_hash or content_hash
        # Attach synthesised ids back onto a shallow copy via namespace-style attributes used below.
        indexed.append(
            (
                entry_id,
                unit_id,
                source_hash,
                content_hash,
                body_json,
                row,
            )
        )

    conn.executemany(
        "INSERT INTO commentary_entries("
        "work_id,entry_id,unit_id,osis_code,chapter,verse_start,verse_end,"
        "body_json,source_hash,content_hash,provenance_id,release_version) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                work_id,
                entry_id,
                unit_id,
                row.osis,
                row.chapter,
                row.verse_start,
                row.verse_end,
                body_json,
                source_hash,
                content_hash,
                provenance_id,
                release_version,
            )
            for entry_id, unit_id, source_hash, content_hash, body_json, row in indexed
        ],
    )
    conn.executemany(
        "INSERT INTO commentary_fts"
        "(text,work_id,entry_id,osis,testament,book_order,chapter,verse_start) "
        "VALUES(?,?,?,?,?,?,?,?)",
        [
            (
                row.plain_text,
                work_id,
                entry_id,
                row.osis,
                BY_OSIS[row.osis].testament if row.osis in BY_OSIS else "NT",
                BY_OSIS[row.osis].order if row.osis in BY_OSIS else 999,
                row.chapter,
                row.verse_start,
            )
            for entry_id, unit_id, source_hash, content_hash, body_json, row in indexed
        ],
    )
    if block_provenance:
        conn.executemany(
            "INSERT INTO commentary_block_provenance("
            "work_id,unit_id,block_index,provenance_id) VALUES(?,?,?,?)",
            [
                (work_id, unit_id, block_index, pid)
                for unit_id, block_index, pid in block_provenance
            ],
        )


def _write_work(
    conn: sqlite3.Connection,
    meta: WorkMeta,
    books: list[BookMeta],
    verses: list[VerseRow],
    headings: list[HeadingRow],
    tokens: list[TokenRow] | None = None,
) -> None:
    _insert_work(conn, meta)
    conn.executemany(
        "INSERT INTO books(work_id,osis_code,name,sort_order,chapter_count) VALUES(?,?,?,?,?)",
        [(meta.id, b.osis, b.name, b.order, b.chapter_count) for b in books],
    )
    conn.executemany(
        "INSERT INTO verses(work_id,osis_code,chapter,verse,nodes_json,plain_text) "
        "VALUES(?,?,?,?,?,?)",
        [
            (
                meta.id,
                v.osis,
                v.chapter,
                v.verse,
                json.dumps(v.cir, ensure_ascii=False),
                v.plain_text,
            )
            for v in verses
        ],
    )
    conn.executemany(
        "INSERT INTO headings(work_id,osis_code,chapter,before_verse,kind,text) "
        "VALUES(?,?,?,?,?,?)",
        [(meta.id, h.osis, h.chapter, h.before_verse, h.kind, h.text) for h in headings],
    )
    if tokens:
        conn.executemany(
            "INSERT INTO verse_tokens"
            "(work_id,osis_code,chapter,verse,position,ordinal,surface,normalized,"
            "strong_id,morph_scheme,morph_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    meta.id,
                    t.osis,
                    t.chapter,
                    t.verse,
                    t.position,
                    t.ordinal,
                    t.surface,
                    t.normalized,
                    t.strong_id,
                    t.morph_scheme,
                    t.morph_code,
                )
                for t in tokens
            ],
        )
    conn.executemany(
        "INSERT INTO bible_fts(text,work_id,ref,osis,testament,book_order,chapter,verse) "
        "VALUES(?,?,?,?,?,?,?,?)",
        [
            (
                v.plain_text,
                meta.id,
                f"{v.osis}.{v.chapter}.{v.verse}",
                v.osis,
                BY_OSIS[v.osis].testament if v.osis in BY_OSIS else "NT",
                BY_OSIS[v.osis].order if v.osis in BY_OSIS else 999,
                v.chapter,
                v.verse,
            )
            for v in verses
        ],
    )


def build_bible(
    source: str | Path,
    spec: BibleSpec,
    out_db: str | Path,
    fmt: str = "usfx",
) -> Diagnostics:
    """Parse a Bible source and (re)create the content DB with it. Returns diagnostics."""
    source = Path(source)
    out_db = Path(out_db)
    if fmt != "usfx":
        raise ValueError(f"unsupported format: {fmt} (M1 supports 'usfx')")

    books, verses, headings = usfx.load_usfx(source)
    diag = validate(books, verses, headings)
    if not diag.ok:
        return diag  # do not write a broken DB

    meta = WorkMeta(
        id=spec.work_id,
        type="bible",
        language=spec.language,
        title=spec.title,
        abbrev=spec.abbrev,
        direction=spec.direction,
        versification=spec.versification,
        license=spec.license,
        attribution=spec.attribution,
        source_url=spec.source_url,
        source_version=spec.source_version,
        ai_context_policy=spec.ai_context_policy,
        checksum=source_sha256(source),
    )

    out_db.parent.mkdir(parents=True, exist_ok=True)
    if out_db.exists():
        out_db.unlink()
    conn = sqlite3.connect(out_db)
    try:
        create_schema(conn)
        _write_work(conn, meta, books, verses, headings)
        conn.commit()
        conn.execute("PRAGMA optimize")
        # Ship a clean single-file DB (no -wal) so the API can open it read-only trivially.
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode=DELETE")
    finally:
        conn.close()
    return diag


# Single source of truth for the Easton work's recorded source_version, keyed by the format the
# dictionary adapter reports. Both the stored WorkMeta and the CLI audit line read it from here.
_EASTON_SOURCE_VERSIONS = {
    "raw-tei": "CrossWire Easton 2.0.1 (raw TEI mod2imp)",
    "stripped": "CrossWire Easton",
    "thml": "CCEL ThML",
}


def easton_source_version(easton_diag: dict) -> str:
    """Recorded source_version for the Easton diagnostics; unknown formats fail loudly."""
    try:
        return _EASTON_SOURCE_VERSIONS[easton_diag["format"]]
    except KeyError as exc:
        raise ValueError(f"unknown Easton source format: {easton_diag.get('format')!r}") from exc


def append_study_content(
    out_db: str | Path,
    commentary_sources: list[str | Path],
    dictionary_source: str | Path,
    xref_source: str | Path,
    *,
    expected_dictionary_entries: int | None = None,
) -> tuple[dict[str, int], dict]:
    """Append the fixed M3 public-domain study library to an existing Bible DB.

    Returns (row-count stats, easton reference diagnostics). The diagnostics dict carries
    the raw-TEI reference classification (or just {"format": ...} for legacy sources) and
    is meant for the build's JSON diagnostics artifact.
    """
    out_db = Path(out_db)
    commentary_paths = [Path(path) for path in commentary_sources]
    dictionary_path = Path(dictionary_source)
    xref_path = Path(xref_source)
    if not out_db.exists():
        raise ValueError(f"content database does not exist: {out_db}")
    if not commentary_paths:
        raise ValueError("at least one commentary source is required")

    sword_commentary = all(path.name.endswith((".imp", ".imp.gz")) for path in commentary_paths)
    sword_dict = dictionary_path.name.endswith((".imp", ".imp.gz"))
    commentary_audit = study.CommentaryKeyAudit()
    commentary = (
        study.load_sword_commentary(commentary_paths, audit=commentary_audit)
        if sword_commentary
        else study.load_commentary(commentary_paths)
    )
    # Every raw key must land in a bucket. The import this replaces skipped whatever it could not
    # place and still reported success, so 18 books and 1,106 chapter introductions disappeared
    # without a warning. An unclassifiable key now stops the build instead.
    if sword_commentary and commentary_audit.fatal_unmatched:
        sample = ", ".join(sorted(commentary_audit.fatal_unmatched)[:5])
        raise ValueError(
            f"{len(commentary_audit.fatal_unmatched)} commentary key(s) carry content but could not "
            f"be placed, and dropping them would lose text: {sample}"
        )
    if sword_dict:
        dictionary, easton_diag = sword_dictionary.load_dictionary_imp(
            dictionary_path,
            expected_entries=expected_dictionary_entries,
        )
    else:
        dictionary = study.load_dictionary(dictionary_path)
        easton_diag = {"format": "thml", "entries": len(dictionary)}
    xrefs = study.load_xrefs(xref_path)
    if not commentary or not dictionary or not xrefs:
        raise ValueError("a study source parsed to zero entries")

    mhc = WorkMeta(
        id="mhc",
        type="commentary",
        language="en",
        title="Matthew Henry's Commentary on the Whole Bible",
        abbrev="MHC",
        direction="ltr",
        versification="kjv",
        license="Public Domain",
        attribution=(
            "Matthew Henry, Commentary on the Whole Bible (1706). "
            "Public-domain CrossWire SWORD module."
        ),
        source_url="https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=MHC",
        source_version="CrossWire MHC 2.2" if sword_commentary else "CCEL ThML",
        ai_context_policy="allowed",
        checksum=_combined_sha256(commentary_paths),
    )
    easton = WorkMeta(
        id="easton",
        type="dictionary",
        language="en",
        title="Easton's Bible Dictionary",
        abbrev="EBD",
        direction="ltr",
        versification="kjv",
        license="Public Domain",
        attribution=(
            "M. G. Easton, Illustrated Bible Dictionary, Third Edition (1897). "
            "Public-domain CrossWire SWORD module."
        ),
        source_url="https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=Easton",
        source_version=easton_source_version(easton_diag),
        ai_context_policy="allowed",
        checksum=source_sha256(dictionary_path),
    )
    tsk = WorkMeta(
        id="tsk",
        type="xref",
        language="en",
        title="Treasury of Scripture Knowledge Cross-References",
        abbrev="TSK",
        direction="ltr",
        versification="kjv",
        license="CC BY 4.0",
        # CC BY 4.0 §3(a)(1) asks for the creator, a licence notice, a URI to the licence, and
        # — §3(a)(1)(B) — an indication of whether the material was modified. This string is what
        # travels in works.attribution into content.sqlite and the container image, and what
        # WorkFooter renders, so it is the only place those can reach someone holding just the
        # artifact. The licence URI and the no-modification statement were missing.
        attribution=(
            "Cross-reference data derived from the Treasury of Scripture Knowledge; "
            "CrossReferences.org, CC BY 4.0 "
            "(https://creativecommons.org/licenses/by/4.0/). "
            "Reference data used unmodified; mapped to this application's verse identifiers."
        ),
        source_url="https://github.com/CrossReferences-org/bible-cross-references",
        source_version="KJV mapping",
        ai_context_policy="allowed",
        checksum=source_sha256(xref_path),
    )

    conn = sqlite3.connect(out_db)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN")
        for meta in (mhc, easton, tsk):
            _insert_work(conn, meta)

        # Source-import provenance: CrossWire MHC is not machine-translated.
        mhc_provenance = "src:crosswire-mhc-2.2"
        mhc_release = "source"
        _ensure_provenance(
            conn,
            mhc_provenance,
            model_canonical_slug=None,
            run_id="add-study",
            translated_at=None,
        )
        conn.execute(
            "INSERT INTO commentary_releases(work_id,release_version,manifest_checksum,built_at) "
            "VALUES(?,?,?,?)",
            (mhc.id, mhc_release, mhc.checksum, "1970-01-01T00:00:00Z"),
        )
        _insert_commentary_rows(
            conn,
            work_id=mhc.id,
            source_work_id="mhc",
            rows=commentary,
            provenance_id=mhc_provenance,
            release_version=mhc_release,
        )
        # Full English MHC: source_units == translated_units, complete.
        from collections import Counter as _Counter

        from .formats.commentary_pack import BookCoverageHint

        mhc_hints = {
            osis: BookCoverageHint(source_units=count, excluded_units=0, state="mt_complete")
            for osis, count in _Counter(r.osis for r in commentary).items()
        }
        _recompute_coverage_for_books(
            conn,
            work_id=mhc.id,
            source_work_id="mhc",
            release_version=mhc_release,
            osis_codes=set(mhc_hints),
            coverage_hints=mhc_hints,
        )
        conn.executemany(
            "INSERT INTO dictionary_entries(work_id,headword,sort_key,language,body_json) "
            "VALUES(?,?,?,?,?)",
            [
                (
                    easton.id,
                    row.headword,
                    row.sort_key,
                    row.language,
                    json.dumps(row.body, ensure_ascii=False),
                )
                for row in dictionary
            ],
        )
        conn.executemany(
            "INSERT INTO dictionary_fts(text,headword_text,work_id,headword,sort_key) "
            "VALUES(?,?,?,?,?)",
            [
                (row.plain_text, row.headword, easton.id, row.headword, row.sort_key)
                for row in dictionary
            ],
        )
        conn.executemany(
            "INSERT INTO xrefs(osis_code,chapter,verse,target_ref,votes) VALUES(?,?,?,?,?)",
            [(row.osis, row.chapter, row.verse, row.target_ref, row.votes) for row in xrefs],
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    stats = {
        "commentary_entries": len(commentary),
        "dictionary_entries": len(dictionary),
        "xrefs": len(xrefs),
    }
    if sword_commentary:
        # Published in the audit record so the accounting is checkable after the fact, not only
        # at build time: buckets must sum to the raw key count.
        stats["commentary_keys"] = {
            "imported": commentary_audit.imported,
            "chapter_introductions": sum(1 for row in commentary if row.verse_start is None),
            "ignored_scaffolding": commentary_audit.ignored_scaffolding,
            "fatal_unmatched": len(commentary_audit.fatal_unmatched),
            "total": commentary_audit.total,
        }
    return stats, easton_diag


def append_bible(
    source: str | Path,
    spec: BibleSpec,
    out_db: str | Path,
    fmt: str = "sword-imp",
) -> Diagnostics:
    """Append another immutable Bible work to an existing content database."""
    source = Path(source)
    out_db = Path(out_db)
    if not out_db.exists():
        raise ValueError(f"content database does not exist: {out_db}")
    if fmt != "sword-imp":
        raise ValueError(f"unsupported append format: {fmt}")
    books, verses, headings, tokens = sword_bible.load_sword_bible(source)
    diag = validate(books, verses, headings)
    if not diag.ok:
        return diag
    tagged = [token for token in tokens if token.strong_id is not None]
    diag.stats.update(
        {
            "verse_tokens": len(tokens),
            "strong_ids": len(tagged),
            "multi_strong_spans": len(
                {(t.osis, t.chapter, t.verse, t.position) for t in tagged if t.ordinal > 0}
            ),
        }
    )
    sentinel = spec.lexical_sentinel
    if sentinel is not None:
        sentinel_tokens = [
            token
            for token in tagged
            if (token.osis, token.chapter, token.verse)
            == (sentinel.osis, sentinel.chapter, sentinel.verse)
        ]
        actual_spans = len({token.position for token in sentinel_tokens})
        actual_ids = len(sentinel_tokens)
        if (actual_spans, actual_ids) != (sentinel.tagged_spans, sentinel.strong_ids):
            diag.errors.append(
                "lexical sentinel mismatch for "
                f"{sentinel.osis}.{sentinel.chapter}.{sentinel.verse}: expected "
                f"{sentinel.tagged_spans} tagged spans/{sentinel.strong_ids} Strong's ids, "
                f"found {actual_spans}/{actual_ids}"
            )
            return diag
    source_checksum = (
        source_content_sha256(source) if spec.source_is_generated else source_sha256(source)
    )
    meta = WorkMeta(
        id=spec.work_id,
        type="bible",
        language=spec.language,
        title=spec.title,
        abbrev=spec.abbrev,
        direction=spec.direction,
        versification=spec.versification,
        license=spec.license,
        attribution=spec.attribution,
        source_url=spec.source_url,
        source_version=spec.source_version,
        ai_context_policy=spec.ai_context_policy,
        checksum=source_checksum,
    )
    conn = sqlite3.connect(out_db)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        expected = spec.expected_alignment or AlignmentExpectation()
        if expected.base_work_id:
            base_work = conn.execute(
                "SELECT id,checksum FROM works WHERE type='bible' AND id=?",
                (expected.base_work_id,),
            ).fetchone()
        else:
            base_work = conn.execute(
                "SELECT id,checksum FROM works WHERE type='bible' ORDER BY rowid LIMIT 1"
            ).fetchone()
        if expected.source_checksum and source_checksum != expected.source_checksum:
            diag.errors.append(
                "source checksum does not match the reviewed alignment expectation: "
                f"expected {expected.source_checksum}, got {source_checksum}"
            )
        if base_work:
            if expected.base_checksum and base_work[1] != expected.base_checksum:
                diag.errors.append(
                    "base Bible checksum does not match the reviewed alignment expectation: "
                    f"expected {expected.base_checksum}, got {base_work[1]}"
                )
            base_keys = {
                (row[0], row[1], row[2])
                for row in conn.execute(
                    "SELECT osis_code,chapter,verse FROM verses WHERE work_id=?",
                    (base_work[0],),
                )
            }
            other_keys = {(verse.osis, verse.chapter, verse.verse) for verse in verses}
            alignment = align_versification(base_keys, other_keys)
            actual = {side: set(refs) for side, refs in alignment.items()}
            allowed = {
                "missing_in_other": set(expected.missing_in_other),
                "missing_in_base": set(expected.missing_in_base),
            }
            unexpected = {
                side: sorted(actual[side] - allowed[side])
                for side in ("missing_in_other", "missing_in_base")
            }
            no_longer_present = {
                side: sorted(allowed[side] - actual[side])
                for side in ("missing_in_other", "missing_in_base")
            }
            diag.alignment = {
                "base_work_id": base_work[0],
                "base_checksum": base_work[1],
                "source_checksum": source_checksum,
                "actual": alignment,
                "expected": {side: sorted(refs) for side, refs in allowed.items()},
                "unexpected": unexpected,
                "expected_but_absent": no_longer_present,
            }
            for side in ("missing_in_other", "missing_in_base"):
                refs = sorted(actual[side] & allowed[side])
                if refs:
                    preview = ", ".join(
                        f"{osis}.{chapter}.{verse}" for osis, chapter, verse in refs[:8]
                    )
                    diag.warnings.append(
                        f"expected versification {side}: {len(refs)} refs ({preview})"
                    )
            for side in ("missing_in_other", "missing_in_base"):
                if unexpected[side]:
                    diag.errors.append(
                        f"unexpected versification {side}: {len(unexpected[side])} refs"
                    )
                if no_longer_present[side]:
                    diag.errors.append(
                        f"reviewed versification {side} changed: "
                        f"{len(no_longer_present[side])} expected refs are now absent"
                    )
        elif expected.base_work_id:
            diag.errors.append(f"reviewed base Bible {expected.base_work_id!r} is not present")

        # Alignment and checksum validation must finish before the write transaction begins.
        if not diag.ok:
            return diag
        conn.execute("BEGIN")
        _write_work(conn, meta, books, verses, headings, tokens)
        conn.commit()
        conn.execute("PRAGMA optimize")
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode=DELETE")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return diag


def append_strongs(
    out_db: str | Path,
    *,
    greek_source: str | Path,
    hebrew_source: str | Path,
    expected_greek_entries: int | None = strongs_lexicon.EXPECTED_STRONGS_GREEK_ENTRIES,
    expected_greek_sequence_gaps: int | None = strongs_lexicon.EXPECTED_GREEK_SEQUENCE_GAPS,
    expected_greek_cjk_annotations: int | None = strongs_lexicon.EXPECTED_GREEK_CJK_ANNOTATIONS,
    expected_greek_anomalies: frozenset[tuple[str, str]]
    | None = strongs_lexicon.EXPECTED_GREEK_ANOMALIES,
    expected_hebrew_entries: int | None = strongs_lexicon.EXPECTED_STRONGS_HEBREW_ENTRIES,
    expected_hebrew_cleanups: int | None = strongs_lexicon.EXPECTED_HEBREW_BYTE_CLEANUPS,
) -> tuple[dict[str, int], dict]:
    """Append the M8 Strong's lexical library (Greek + Hebrew) to an existing content DB.

    Both modules are public-domain derivatives of Strong's Exhaustive Concordance (1890).
    Returns (row-count stats, per-module diagnostics) for the build's JSON artifact.
    """
    out_db = Path(out_db)
    greek_path = Path(greek_source)
    hebrew_path = Path(hebrew_source)
    if not out_db.exists():
        raise ValueError(f"content database does not exist: {out_db}")
    greek, greek_diag = strongs_lexicon.load_strongs_greek(
        greek_path,
        expected_entries=expected_greek_entries,
        expected_sequence_gaps=expected_greek_sequence_gaps,
        expected_cjk_annotations=expected_greek_cjk_annotations,
        expected_anomalies=expected_greek_anomalies,
    )
    hebrew, hebrew_diag = strongs_lexicon.load_strongs_hebrew(
        hebrew_path,
        expected_entries=expected_hebrew_entries,
        expected_cleanups=expected_hebrew_cleanups,
    )
    if not greek or not hebrew:
        raise ValueError("a Strong's lexicon source parsed to zero entries")
    greek_meta = WorkMeta(
        id="strongsgreek",
        type="lexicon",
        language="grc",
        title="Strong's Greek Dictionary",
        abbrev="StrGrk",
        direction="ltr",
        versification="none",
        license="Public Domain",
        attribution=(
            "James Strong, Exhaustive Concordance of the Bible (1890). "
            "Public-domain CrossWire SWORD module."
        ),
        source_url="https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsGreek",
        source_version="CrossWire StrongsGreek 2.0",
        ai_context_policy="allowed",
        checksum=source_sha256(greek_path),
    )
    hebrew_meta = WorkMeta(
        id="strongshebrew",
        type="lexicon",
        language="hbo",
        title="Strong's Hebrew Dictionary",
        abbrev="StrHeb",
        direction="ltr",
        versification="none",
        license="Public Domain",
        attribution=(
            "James Strong, Exhaustive Concordance of the Bible (1890). "
            "Public-domain CrossWire SWORD module."
        ),
        source_url="https://www.crosswire.org/sword/modules/ModInfo.jsp?modName=StrongsHebrew",
        source_version="CrossWire StrongsHebrew 1.2",
        ai_context_policy="allowed",
        checksum=source_sha256(hebrew_path),
    )
    conn = sqlite3.connect(out_db)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN")
        for meta in (greek_meta, hebrew_meta):
            _insert_work(conn, meta)
        conn.executemany(
            "INSERT INTO strong_lexicon"
            "(strong_id,language,lemma,transliteration,pronunciation,definition_json,"
            "lemma_search,transliteration_search,definition_search) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            [
                (
                    row.strong_id,
                    row.language,
                    row.lemma,
                    row.transliteration,
                    row.pronunciation,
                    json.dumps(row.definition, ensure_ascii=False),
                    normalize_lexical_search(row.lemma),
                    (
                        normalize_lexical_search(row.transliteration)
                        if row.transliteration
                        else None
                    ),
                    normalize_lexical_search(row.plain_text),
                )
                for row in (*greek, *hebrew)
            ],
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {
        "strongs_greek_entries": len(greek),
        "strongs_hebrew_entries": len(hebrew),
    }, {"greek": greek_diag, "hebrew": hebrew_diag}


def append_book(
    source: str | Path,
    spec: BookSpec,
    out_db: str | Path,
    fmt: str = "sword-imp",
) -> int:
    """Append an immutable hierarchical General Book work to an existing content database."""
    source = Path(source)
    out_db = Path(out_db)
    if not out_db.exists():
        raise ValueError(f"content database does not exist: {out_db}")
    if fmt != "sword-imp":
        raise ValueError(f"unsupported General Book format: {fmt}")
    sections = genbook.load_genbook(source)
    if not sections:
        raise ValueError("General Book source parsed to zero sections")
    meta = WorkMeta(
        id=spec.work_id,
        type="book",
        language=spec.language,
        title=spec.title,
        abbrev=spec.abbrev,
        direction=spec.direction,
        versification="none",
        license=spec.license,
        attribution=spec.attribution,
        source_url=spec.source_url,
        source_version=spec.source_version,
        ai_context_policy=spec.ai_context_policy,
        checksum=source_sha256(source),
    )
    conn = sqlite3.connect(out_db)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN")
        _insert_work(conn, meta)
        conn.executemany(
            "INSERT INTO book_sections"
            "(work_id,section_id,parent_id,sort_order,level,title,body_json) "
            "VALUES(?,?,?,?,?,?,?)",
            [
                (
                    meta.id,
                    row.section_id,
                    row.parent_id,
                    row.sort_order,
                    row.level,
                    row.title,
                    json.dumps(row.body, ensure_ascii=False),
                )
                for row in sections
            ],
        )
        # Index every section that has a body or a title (parent/chapter nodes are title-only but
        # should still be findable by their heading); title_text is a weighted searchable column.
        conn.executemany(
            "INSERT INTO book_fts(text,title_text,work_id,section_id,sort_order) VALUES(?,?,?,?,?)",
            [
                (row.plain_text, row.title, meta.id, row.section_id, row.sort_order)
                for row in sections
                if row.plain_text or row.title
            ],
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return len(sections)


def append_commentary(
    source: str | Path,
    spec: CommentarySpec,
    out_db: str | Path,
    *,
    expected_checksum: str | None = None,
    osis_code: str | None = None,
    quality_label: str | None = None,
) -> dict:
    """Import or re-release a commentary package into an existing content DB.

    - New unit_ids are inserted with fresh per-work entry_ids.
    - Existing unit_ids are **updated** in place (body, hashes, provenance, release_version)
      so a rebuild can advance release_version without retranslating, and corrections can
      replace a unit. FTS is rewritten for those rows.
    - Coverage is derived from DB counts + optional package_meta hints, never forced complete.
    - Provenance rows require full metadata and refuse silent conflicts.
    """
    from datetime import UTC, datetime

    from .books import BY_OSIS

    source = Path(source)
    out_db = Path(out_db)
    if not out_db.exists():
        raise ValueError(f"content database does not exist: {out_db}")

    loaded = commentary_pack.load_commentary_package(source, expected_checksum=expected_checksum)
    if osis_code is not None:
        loaded.rows = [row for row in loaded.rows if row.osis == osis_code]
        if not loaded.rows:
            raise ValueError(f"package has no rows for osis_code={osis_code!r}")
        selected_units = {row.unit_id for row in loaded.rows}
        loaded.block_provenance = [
            item for item in loaded.block_provenance if item[0] in selected_units
        ]
        loaded.coverage = {
            osis: hint for osis, hint in loaded.coverage.items() if osis == osis_code
        }
        loaded.reviews = [review for review in loaded.reviews if review.unit_id in selected_units]

    imported_books = {row.osis for row in loaded.rows}
    missing_coverage = imported_books - set(loaded.coverage)

    meta = WorkMeta(
        id=spec.work_id,
        type="commentary",
        language=spec.language,
        title=spec.title,
        abbrev=spec.abbrev,
        direction=spec.direction,
        versification=spec.versification,
        license=spec.license,
        attribution=spec.attribution,
        source_url=spec.source_url,
        source_version=spec.source_version,
        ai_context_policy=spec.ai_context_policy,
        checksum=loaded.package_checksum,
    )
    built_at = datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    label = (
        quality_label
        if quality_label is not None
        else (spec.quality_label if spec.quality_label is not None else loaded.quality_label)
    )
    inserted = 0
    updated = 0
    manifest = ""

    conn = sqlite3.connect(out_db)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("BEGIN")
        existing = conn.execute(
            "SELECT type, language, title, abbrev, direction, versification, license, "
            "attribution, source_url, source_version, ai_context_policy "
            "FROM works WHERE id=?",
            (spec.work_id,),
        ).fetchone()
        if existing is None:
            if missing_coverage:
                raise ValueError(
                    "coverage metadata is required for first import of: "
                    + ", ".join(sorted(missing_coverage))
                )
            _insert_work(conn, meta, quality_label=label)
        else:
            if existing[0] != "commentary":
                raise ValueError(f"work {spec.work_id!r} exists but is not a commentary")
            expected_meta = (
                spec.language,
                spec.title,
                spec.abbrev,
                spec.direction,
                spec.versification,
                spec.license,
                spec.attribution,
                spec.source_url,
                spec.source_version,
                spec.ai_context_policy,
            )
            if tuple(existing[1:]) != expected_meta:
                raise ValueError(
                    f"work {spec.work_id!r} metadata differs from its first package; "
                    "rebuild the generated database to change work metadata"
                )
            if label is not None:
                conn.execute(
                    "UPDATE works SET quality_label=? WHERE id=?",
                    (label, spec.work_id),
                )

        # Package-declared provenances are authoritative (full metadata). CLI fills the default
        # only when the package did not declare that id — never overwrite with different fields.
        declared: dict[str, commentary_pack.ProvenanceRecord] = dict(loaded.provenances)
        for _uid, _bi, rec in loaded.block_provenance:
            declared.setdefault(rec.provenance_id, rec)
        for rec in declared.values():
            _ensure_provenance(
                conn,
                rec.provenance_id,
                model_request_id=rec.model_request_id,
                model_canonical_slug=rec.model_canonical_slug,
                model_returned=rec.model_returned,
                prompt_hash=rec.prompt_hash,
                glossary_hash=rec.glossary_hash,
                settings_json=rec.settings_json,
                run_id=rec.run_id,
                translated_at=rec.translated_at,
            )
        entry_provenance_ids = {row.provenance_id for row in loaded.rows}
        if None in entry_provenance_ids:
            raise ValueError("every package entry must carry provenance_id")
        undeclared = {
            pid
            for pid in entry_provenance_ids
            if pid is not None and pid != spec.provenance_id and pid not in declared
        }
        if undeclared:
            raise ValueError(
                "entry provenance is not declared in package_meta: " + ", ".join(sorted(undeclared))
            )
        if spec.provenance_id in entry_provenance_ids and spec.provenance_id not in declared:
            _ensure_provenance(
                conn,
                spec.provenance_id,
                model_request_id=spec.model_request_id,
                model_canonical_slug=spec.model_canonical_slug,
                model_returned=spec.model_returned,
                prompt_hash=spec.prompt_hash,
                glossary_hash=spec.glossary_hash,
                settings_json=spec.settings_json,
                run_id=spec.run_id,
                translated_at=spec.translated_at,
            )

        # Release parent row first (FK parent of packages), then packages, then
        # rewrite manifest_checksum as the hash over ordered package rows.
        conn.execute(
            "INSERT INTO commentary_releases(work_id,release_version,manifest_checksum,built_at) "
            "VALUES(?,?,?,?) "
            "ON CONFLICT(work_id, release_version) DO UPDATE SET built_at=excluded.built_at",
            (spec.work_id, spec.release_version, "pending", built_at),
        )
        for osis in sorted({row.osis for row in loaded.rows}):
            prior_package = conn.execute(
                "SELECT package_checksum FROM commentary_release_packages "
                "WHERE work_id=? AND release_version=? AND osis_code=?",
                (spec.work_id, spec.release_version, osis),
            ).fetchone()
            if prior_package is not None and prior_package[0] != loaded.package_checksum:
                raise ValueError(
                    f"release {spec.work_id}/{spec.release_version} already has a different "
                    f"package for {osis}; release artifacts are immutable"
                )
            conn.execute(
                "INSERT INTO commentary_release_packages("
                "work_id,release_version,osis_code,package_checksum) VALUES(?,?,?,?) "
                "ON CONFLICT(work_id, release_version, osis_code) DO UPDATE SET "
                "package_checksum=excluded.package_checksum",
                (spec.work_id, spec.release_version, osis, loaded.package_checksum),
            )
        manifest = _release_manifest_checksum(conn, spec.work_id, spec.release_version)
        conn.execute(
            "UPDATE commentary_releases SET manifest_checksum=?, built_at=? "
            "WHERE work_id=? AND release_version=?",
            (manifest, built_at, spec.work_id, spec.release_version),
        )
        # content_version hashes works.checksum. Include both the manifest and its release id:
        # a metadata-only re-release changes API responses even when package bytes are identical.
        work_checksum = _work_release_checksum(spec.release_version, manifest)
        conn.execute(
            "UPDATE works SET checksum=? WHERE id=?",
            (work_checksum, spec.work_id),
        )

        max_id = conn.execute(
            "SELECT COALESCE(MAX(entry_id), 0) FROM commentary_entries WHERE work_id=?",
            (spec.work_id,),
        ).fetchone()[0]
        next_id = max_id + 1
        inserted = 0
        updated = 0

        for row in loaded.rows:
            if row.unit_id is None:
                raise ValueError("package row missing unit_id after load")
            body_json = json.dumps(
                row.body, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            )
            content_hash = row.content_hash or hashlib.sha256(body_json.encode()).hexdigest()
            source_hash = row.source_hash
            if not source_hash:
                raise ValueError(f"unit {row.unit_id}: source_hash is required")
            if row.unit_id.split("/", 1)[0] != spec.source_work_id:
                raise ValueError(
                    f"unit {row.unit_id!r} does not belong to source work {spec.source_work_id!r}"
                )
            provenance_id = row.provenance_id
            if provenance_id is None:
                raise ValueError(f"unit {row.unit_id}: provenance_id is required")

            existing_entry = conn.execute(
                "SELECT entry_id, source_hash FROM commentary_entries "
                "WHERE work_id=? AND unit_id=?",
                (spec.work_id, row.unit_id),
            ).fetchone()

            if existing_entry is None:
                entry_id = next_id
                next_id += 1
                conn.execute(
                    "INSERT INTO commentary_entries("
                    "work_id,entry_id,unit_id,osis_code,chapter,verse_start,verse_end,"
                    "body_json,source_hash,content_hash,provenance_id,release_version) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        spec.work_id,
                        entry_id,
                        row.unit_id,
                        row.osis,
                        row.chapter,
                        row.verse_start,
                        row.verse_end,
                        body_json,
                        source_hash,
                        content_hash,
                        provenance_id,
                        spec.release_version,
                    ),
                )
                conn.execute(
                    "INSERT INTO commentary_fts"
                    "(text,work_id,entry_id,osis,testament,book_order,chapter,verse_start) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (
                        row.plain_text,
                        spec.work_id,
                        entry_id,
                        row.osis,
                        BY_OSIS[row.osis].testament if row.osis in BY_OSIS else "NT",
                        BY_OSIS[row.osis].order if row.osis in BY_OSIS else 999,
                        row.chapter,
                        row.verse_start,
                    ),
                )
                inserted += 1
            else:
                entry_id = existing_entry[0]
                if existing_entry[1] != source_hash:
                    raise ValueError(
                        f"source_hash changed for {spec.work_id}/{row.unit_id}; "
                        "source revisions require an explicit unit-id migration"
                    )
                conn.execute(
                    "UPDATE commentary_entries SET "
                    "osis_code=?, chapter=?, verse_start=?, verse_end=?, body_json=?, "
                    "source_hash=?, content_hash=?, provenance_id=?, release_version=? "
                    "WHERE work_id=? AND unit_id=?",
                    (
                        row.osis,
                        row.chapter,
                        row.verse_start,
                        row.verse_end,
                        body_json,
                        source_hash,
                        content_hash,
                        provenance_id,
                        spec.release_version,
                        spec.work_id,
                        row.unit_id,
                    ),
                )
                # FTS5 content tables: delete + reinsert (no reliable UPDATE of content columns).
                conn.execute(
                    "DELETE FROM commentary_fts WHERE work_id=? AND entry_id=?",
                    (spec.work_id, entry_id),
                )
                conn.execute(
                    "INSERT INTO commentary_fts"
                    "(text,work_id,entry_id,osis,testament,book_order,chapter,verse_start) "
                    "VALUES(?,?,?,?,?,?,?,?)",
                    (
                        row.plain_text,
                        spec.work_id,
                        entry_id,
                        row.osis,
                        BY_OSIS[row.osis].testament if row.osis in BY_OSIS else "NT",
                        BY_OSIS[row.osis].order if row.osis in BY_OSIS else 999,
                        row.chapter,
                        row.verse_start,
                    ),
                )
                # Drop stale block overrides; re-applied below.
                conn.execute(
                    "DELETE FROM commentary_block_provenance WHERE work_id=? AND unit_id=?",
                    (spec.work_id, row.unit_id),
                )
                updated += 1

        # Block overrides: every block with an override must have a registered provenance row.
        if loaded.block_provenance:
            for unit_id, block_index, rec in loaded.block_provenance:
                exists = conn.execute(
                    "SELECT 1 FROM commentary_entries WHERE work_id=? AND unit_id=?",
                    (spec.work_id, unit_id),
                ).fetchone()
                if not exists:
                    raise ValueError(f"block provenance for unknown unit_id {unit_id!r}")
                n_blocks = conn.execute(
                    "SELECT body_json FROM commentary_entries WHERE work_id=? AND unit_id=?",
                    (spec.work_id, unit_id),
                ).fetchone()
                body = json.loads(n_blocks[0])
                if block_index < 0 or block_index >= len(body.get("blocks", [])):
                    raise ValueError(f"block_index out of range for {unit_id}")
            conn.executemany(
                "INSERT INTO commentary_block_provenance("
                "work_id,unit_id,block_index,provenance_id) VALUES(?,?,?,?) "
                "ON CONFLICT(work_id, unit_id, block_index) DO UPDATE SET "
                "provenance_id=excluded.provenance_id",
                [
                    (spec.work_id, unit_id, bi, rec.provenance_id)
                    for unit_id, bi, rec in loaded.block_provenance
                ],
            )

        review_books: set[str] = set()
        for review in loaded.reviews:
            review_entry = conn.execute(
                "SELECT osis_code, content_hash FROM commentary_entries "
                "WHERE work_id=? AND unit_id=?",
                (spec.work_id, review.unit_id),
            ).fetchone()
            if review_entry is None:
                raise ValueError(f"review refers to unknown unit_id {review.unit_id!r}")
            if review_entry[1] != review.content_hash:
                raise ValueError(
                    f"review content_hash does not match current text for {review.unit_id}"
                )
            conn.execute(
                "INSERT INTO commentary_reviews("
                "work_id,unit_id,content_hash,reviewed_at,kind) VALUES(?,?,?,?,?) "
                "ON CONFLICT(work_id,unit_id,content_hash,kind) DO UPDATE SET "
                "reviewed_at=excluded.reviewed_at",
                (
                    spec.work_id,
                    review.unit_id,
                    review.content_hash,
                    review.reviewed_at,
                    review.kind,
                ),
            )
            review_books.add(review_entry[0])

        _recompute_coverage_for_books(
            conn,
            work_id=spec.work_id,
            source_work_id=spec.source_work_id,
            release_version=spec.release_version,
            osis_codes={row.osis for row in loaded.rows} | set(loaded.coverage) | review_books,
            coverage_hints=loaded.coverage,
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "commentary_entries": len(loaded.rows),
        "inserted": inserted,
        "updated": updated,
        "package_checksum": loaded.package_checksum,
        "record_count": loaded.record_count,
        "work_id": spec.work_id,
        "release_version": spec.release_version,
        "manifest_checksum": manifest,
        "work_checksum": work_checksum,
    }
