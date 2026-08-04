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
    normalize_lexical_search,
)
from .formats import genbook, strongs_lexicon, study, sword_bible, sword_dictionary, usfx
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


def _insert_work(conn: sqlite3.Connection, meta: WorkMeta) -> None:
    conn.execute(
        "INSERT INTO works(id,type,language,title,abbrev,direction,versification,"
        "license,attribution,source_url,source_version,checksum,ai_context_policy) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        ),
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
    commentary = (
        study.load_sword_commentary(commentary_paths)
        if sword_commentary
        else study.load_commentary(commentary_paths)
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
        attribution=(
            "Cross-reference data derived from the Treasury of Scripture Knowledge; "
            "CrossReferences.org, CC BY 4.0."
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

        chapter_counts: dict[str, int] = {}
        for row in commentary:
            chapter_counts[row.osis] = max(chapter_counts.get(row.osis, 0), row.chapter)
        conn.executemany(
            "INSERT INTO books(work_id,osis_code,name,sort_order,chapter_count) VALUES(?,?,?,?,?)",
            [
                (mhc.id, osis, BY_OSIS[osis].name_en, BY_OSIS[osis].order, chapters)
                for osis, chapters in sorted(
                    chapter_counts.items(), key=lambda item: BY_OSIS[item[0]].order
                )
            ],
        )
        # Stable, deterministic entry_id assigned in load order (source order), reused as the FTS
        # locator so commentary can be ordered/paginated without ambiguity.
        indexed_commentary = list(enumerate(commentary, start=1))
        conn.executemany(
            "INSERT INTO commentary_entries"
            "(entry_id,work_id,osis_code,chapter,verse_start,verse_end,body_json) "
            "VALUES(?,?,?,?,?,?,?)",
            [
                (
                    entry_id,
                    mhc.id,
                    row.osis,
                    row.chapter,
                    row.verse_start,
                    row.verse_end,
                    json.dumps(row.body, ensure_ascii=False),
                )
                for entry_id, row in indexed_commentary
            ],
        )
        conn.executemany(
            "INSERT INTO commentary_fts"
            "(text,work_id,entry_id,osis,testament,book_order,chapter,verse_start) "
            "VALUES(?,?,?,?,?,?,?,?)",
            [
                (
                    row.plain_text,
                    mhc.id,
                    entry_id,
                    row.osis,
                    BY_OSIS[row.osis].testament if row.osis in BY_OSIS else "NT",
                    BY_OSIS[row.osis].order if row.osis in BY_OSIS else 999,
                    row.chapter,
                    row.verse_start if row.verse_start is not None else 0,
                )
                for entry_id, row in indexed_commentary
            ],
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
    return {
        "commentary_entries": len(commentary),
        "dictionary_entries": len(dictionary),
        "xrefs": len(xrefs),
    }, easton_diag


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
