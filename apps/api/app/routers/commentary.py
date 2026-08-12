import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import (
    CommentaryCoverageResponse,
    CommentaryCoverageRow,
    CommentaryEntry,
    CommentaryPassage,
    Document,
)

router = APIRouter(prefix=settings.API_V1, tags=["commentary"])


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
    sql += (
        " ORDER BY coalesce(verse_start,0), coalesce(verse_end,0), entry_id"
    )
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
        )
        for row in rows
    ]
    return CommentaryPassage(
        work_id=work_id,
        osis=osis,
        chapter=chapter,
        entries=entries,
    )
