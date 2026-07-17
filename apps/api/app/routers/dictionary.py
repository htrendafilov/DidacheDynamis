import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import DictionaryEntry, DictionaryHeadword, Document

router = APIRouter(prefix=settings.API_V1, tags=["dictionary"])


@router.get(
    "/dictionary/{work_id}/entries",
    response_model=list[DictionaryHeadword],
)
def entries(
    work_id: str,
    prefix: str = Query("", max_length=100),
    limit: int = Query(50, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_conn),
) -> list[DictionaryHeadword]:
    exists = conn.execute(
        "SELECT 1 FROM works WHERE id=? AND type='dictionary'", (work_id,)
    ).fetchone()
    if exists is None:
        raise HTTPException(status_code=404, detail="dictionary work not found")
    normalized = prefix.casefold().strip()
    rows = conn.execute(
        "SELECT headword FROM dictionary_entries "
        "WHERE work_id=? AND sort_key>=? AND sort_key<? ORDER BY sort_key LIMIT ?",
        (work_id, normalized, normalized + "\U0010ffff", limit),
    ).fetchall()
    return [DictionaryHeadword(headword=row["headword"]) for row in rows]


@router.get(
    "/dictionary/{work_id}/entry/{headword:path}",
    response_model=DictionaryEntry,
)
def entry(
    work_id: str,
    headword: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> DictionaryEntry:
    row = conn.execute(
        "SELECT headword,body_json FROM dictionary_entries "
        "WHERE work_id=? AND headword=? COLLATE NOCASE ORDER BY rowid LIMIT 1",
        (work_id, headword),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="dictionary entry not found")
    return DictionaryEntry(
        work_id=work_id,
        headword=row["headword"],
        body=Document(**json.loads(row["body_json"])),
    )
