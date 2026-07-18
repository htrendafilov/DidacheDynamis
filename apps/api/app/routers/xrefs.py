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

    # Parse targets once, then fetch all previews in a single query (avoids N+1).
    parsed: list[tuple[str, str, int, int, int]] = []  # (target_ref, osis, chapter, verse, votes)
    for row in rows:
        match = _TARGET.match(row["target_ref"])
        if not match:
            continue
        parsed.append(
            (row["target_ref"], match.group("osis"), int(match.group("chapter")),
             int(match.group("verse")), row["votes"])
        )

    previews: dict[str, str] = {}
    keys = sorted({f"{p[1]}.{p[2]}.{p[3]}" for p in parsed})
    if keys:
        placeholders = ",".join("?" * len(keys))
        query = (
            "SELECT osis_code||'.'||chapter||'.'||verse AS k, plain_text FROM verses "
            f"WHERE work_id=? AND osis_code||'.'||chapter||'.'||verse IN ({placeholders})"
        )
        for prow in conn.execute(query, (preview_work, *keys)).fetchall():
            previews[prow["k"]] = prow["plain_text"]

    references = [
        CrossReference(
            target_ref=target_ref,
            target_osis=t_osis,
            target_chapter=t_chapter,
            target_verse=t_verse,
            votes=votes,
            preview=previews.get(f"{t_osis}.{t_chapter}.{t_verse}"),
        )
        for target_ref, t_osis, t_chapter, t_verse, votes in parsed
    ]
    return CrossReferences(
        osis=osis,
        chapter=chapter,
        verse=verse,
        source_work_id="tsk",
        references=references,
    )
