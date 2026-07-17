import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import CommentaryEntry, CommentaryPassage, Document

router = APIRouter(prefix=settings.API_V1, tags=["commentary"])


@router.get(
    "/commentary/{work_id}/{osis}/{chapter}",
    response_model=CommentaryPassage,
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
        "SELECT verse_start,verse_end,body_json FROM commentary_entries "
        "WHERE work_id=? AND osis_code=? AND chapter=?"
    )
    params: list = [work_id, osis, chapter]
    if verse is not None:
        sql += (
            " AND (verse_start IS NULL OR verse_start<=?)"
            " AND (verse_end IS NULL OR verse_end>=?)"
        )
        params += [verse, verse]
    sql += " ORDER BY coalesce(verse_start,0), coalesce(verse_end,0), rowid"
    rows = conn.execute(sql, params).fetchall()
    entries = [
        CommentaryEntry(
            verse_start=row["verse_start"],
            verse_end=row["verse_end"],
            body=Document(**json.loads(row["body_json"])),
        )
        for row in rows
    ]
    return CommentaryPassage(
        work_id=work_id,
        osis=osis,
        chapter=chapter,
        entries=entries,
    )
