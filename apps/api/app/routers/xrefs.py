import re
import sqlite3

from fastapi import APIRouter, Depends, Query

from .. import settings
from ..db import get_conn
from ..models import CrossReference, CrossReferences

router = APIRouter(prefix=settings.API_V1, tags=["cross-references"])
_TARGET = re.compile(r"^(?P<osis>[1-3]?[A-Za-z]+)\.(?P<chapter>\d+)\.(?P<verse>\d+)")


@router.get("/xref/{osis}/{chapter}/{verse}", response_model=CrossReferences)
def cross_references(
    osis: str,
    chapter: int,
    verse: int,
    preview_work: str = Query("web"),
    limit: int = Query(100, ge=1, le=200),
    conn: sqlite3.Connection = Depends(get_conn),
) -> CrossReferences:
    rows = conn.execute(
        "SELECT target_ref,votes FROM xrefs WHERE osis_code=? AND chapter=? AND verse=? "
        "ORDER BY votes DESC,target_ref LIMIT ?",
        (osis, chapter, verse, limit),
    ).fetchall()
    references: list[CrossReference] = []
    for row in rows:
        match = _TARGET.match(row["target_ref"])
        if not match:
            continue
        target_osis = match.group("osis")
        target_chapter = int(match.group("chapter"))
        target_verse = int(match.group("verse"))
        preview_row = conn.execute(
            "SELECT plain_text FROM verses WHERE work_id=? AND osis_code=? "
            "AND chapter=? AND verse=?",
            (preview_work, target_osis, target_chapter, target_verse),
        ).fetchone()
        references.append(
            CrossReference(
                target_ref=row["target_ref"],
                target_osis=target_osis,
                target_chapter=target_chapter,
                target_verse=target_verse,
                votes=row["votes"],
                preview=preview_row["plain_text"] if preview_row else None,
            )
        )
    return CrossReferences(
        osis=osis,
        chapter=chapter,
        verse=verse,
        source_work_id="tsk",
        references=references,
    )
