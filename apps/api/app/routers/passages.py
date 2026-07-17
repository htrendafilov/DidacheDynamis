import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import settings
from ..db import get_conn
from ..models import Heading, Line, Passage, Verse

router = APIRouter(prefix=settings.API_V1, tags=["passages"])


@router.get("/works/{work_id}/passage/{osis}/{chapter}", response_model=Passage)
def passage(
    work_id: str,
    osis: str,
    chapter: int,
    conn: sqlite3.Connection = Depends(get_conn),
) -> Passage:
    vrows = conn.execute(
        "SELECT verse, nodes_json FROM verses "
        "WHERE work_id=? AND osis_code=? AND chapter=? ORDER BY verse",
        (work_id, osis, chapter),
    ).fetchall()
    if not vrows:
        raise HTTPException(status_code=404, detail="passage not found")

    verses = [
        Verse(verse=r["verse"], lines=[Line(**ln) for ln in json.loads(r["nodes_json"])["lines"]])
        for r in vrows
    ]
    hrows = conn.execute(
        "SELECT before_verse, kind, text FROM headings "
        "WHERE work_id=? AND osis_code=? AND chapter=? ORDER BY before_verse",
        (work_id, osis, chapter),
    ).fetchall()
    headings = [
        Heading(before_verse=h["before_verse"], kind=h["kind"], text=h["text"]) for h in hrows
    ]
    return Passage(work_id=work_id, osis=osis, chapter=chapter, verses=verses, headings=headings)
