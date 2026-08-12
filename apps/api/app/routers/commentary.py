import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import (
    BlockProvenance,
    CommentaryCoverageResponse,
    CommentaryCoverageRow,
    CommentaryEntry,
    CommentaryPassage,
    Document,
    TranslationProvenance,
)

router = APIRouter(prefix=settings.API_V1, tags=["commentary"])


def _provenance(conn: sqlite3.Connection, provenance_id: str) -> TranslationProvenance:
    row = conn.execute(
        "SELECT provenance_id, model_request_id, model_canonical_slug, model_returned, "
        "prompt_hash, glossary_hash, settings_json, run_id, translated_at "
        "FROM translation_provenance WHERE provenance_id=?",
        (provenance_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"missing translation provenance row: {provenance_id}")
    return TranslationProvenance(**dict(row))


def _block_provenance(
    conn: sqlite3.Connection, work_id: str, unit_id: str
) -> list[BlockProvenance]:
    rows = conn.execute(
        "SELECT bp.block_index, p.provenance_id, p.model_request_id, p.model_canonical_slug, "
        "p.model_returned, p.prompt_hash, p.glossary_hash, p.settings_json, p.run_id, "
        "p.translated_at "
        "FROM commentary_block_provenance bp "
        "JOIN translation_provenance p ON p.provenance_id = bp.provenance_id "
        "WHERE bp.work_id=? AND bp.unit_id=? "
        "ORDER BY bp.block_index",
        (work_id, unit_id),
    ).fetchall()
    out: list[BlockProvenance] = []
    for r in rows:
        out.append(
            BlockProvenance(
                block_index=r["block_index"],
                provenance=TranslationProvenance(
                    provenance_id=r["provenance_id"],
                    model_request_id=r["model_request_id"],
                    model_canonical_slug=r["model_canonical_slug"],
                    model_returned=r["model_returned"],
                    prompt_hash=r["prompt_hash"],
                    glossary_hash=r["glossary_hash"],
                    settings_json=r["settings_json"],
                    run_id=r["run_id"],
                    translated_at=r["translated_at"],
                ),
            )
        )
    return out


@router.get(
    "/commentary/{work_id}/coverage",
    response_model=CommentaryCoverageResponse,
    response_model_exclude_defaults=True,
)
def commentary_coverage(
    work_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> CommentaryCoverageResponse:
    exists = conn.execute(
        "SELECT 1 FROM works WHERE id=? AND type='commentary'", (work_id,)
    ).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="commentary work not found")
    rows = conn.execute(
        "SELECT osis_code, state, source_units, translated_units, excluded_units, "
        "reviewed_units, release_version FROM commentary_coverage "
        "WHERE work_id=? ORDER BY osis_code",
        (work_id,),
    ).fetchall()
    return CommentaryCoverageResponse(
        work_id=work_id,
        books=[
            CommentaryCoverageRow(
                osis_code=row["osis_code"],
                state=row["state"],
                source_units=row["source_units"],
                translated_units=row["translated_units"],
                excluded_units=row["excluded_units"],
                reviewed_units=row["reviewed_units"],
                release_version=row["release_version"],
            )
            for row in rows
        ],
    )


@router.get(
    "/commentary/{work_id}/{osis}/{chapter}",
    response_model=CommentaryPassage,
    response_model_exclude_defaults=True,
)
def commentary(
    work_id: str,
    osis: str,
    chapter: int,
    verse: int | None = Query(None, ge=1),
    conn: sqlite3.Connection = Depends(get_conn),
) -> CommentaryPassage:
    exists = conn.execute(
        "SELECT 1 FROM works WHERE id=? AND type='commentary'", (work_id,)
    ).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="commentary work not found")
    sql = (
        "SELECT entry_id, unit_id, verse_start, verse_end, body_json, "
        "source_hash, content_hash, provenance_id, release_version "
        "FROM commentary_entries "
        "WHERE work_id=? AND osis_code=? AND chapter=?"
    )
    params: list = [work_id, osis, chapter]
    if verse is not None:
        sql += (
            " AND (verse_start IS NULL OR verse_start<=?)"
            " AND (verse_end IS NULL OR verse_end>=?)"
        )
        params += [verse, verse]
    # Deterministic multi-work order: key verse, then per-work entry_id — never table rowid.
    sql += " ORDER BY coalesce(verse_start,0), coalesce(verse_end,0), entry_id"
    rows = conn.execute(sql, params).fetchall()
    entries = [
        CommentaryEntry(
            entry_id=row["entry_id"],
            unit_id=row["unit_id"],
            verse_start=row["verse_start"],
            verse_end=row["verse_end"],
            body=Document(**json.loads(row["body_json"])),
            source_hash=row["source_hash"],
            content_hash=row["content_hash"],
            provenance_id=row["provenance_id"],
            release_version=row["release_version"],
            provenance=_provenance(conn, row["provenance_id"]),
            block_provenance=_block_provenance(conn, work_id, row["unit_id"]),
        )
        for row in rows
    ]
    return CommentaryPassage(
        work_id=work_id,
        osis=osis,
        chapter=chapter,
        entries=entries,
    )
