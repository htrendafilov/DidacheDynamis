import json
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import Heading, Line, Passage, Verse

router = APIRouter(prefix=settings.API_V1, tags=["passages"])

_RANGE = re.compile(r"^(\d+)(?:-(\d+))?$")


def _parse_range(verses: str) -> tuple[int, int]:
    match = _RANGE.match(verses)
    if not match:
        raise HTTPException(status_code=400, detail="invalid verses range")
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else start
    if start < 1 or end < start:
        raise HTTPException(status_code=400, detail="invalid verses range")
    return start, end


@router.get(
    "/works/{work_id}/passage/{osis}/{chapter}",
    response_model=Passage,
    # Run.lemma is optional; omitting it when absent keeps works without lexical
    # data (WEB) byte-identical to their pre-M8 responses (plan §11 M8.2 exit).
    response_model_exclude_none=True,
)
def passage(
    work_id: str,
    osis: str,
    chapter: int,
    verses: str | None = Query(None, description="restrict to a verse range, e.g. '16' or '1-19'"),
    conn: sqlite3.Connection = Depends(get_conn),
) -> Passage:
    limit = _parse_range(verses) if verses is not None else None
    vrows = conn.execute(
        "SELECT verse, nodes_json FROM verses "
        "WHERE work_id=? AND osis_code=? AND chapter=? ORDER BY verse",
        (work_id, osis, chapter),
    ).fetchall()
    if limit is not None:
        vrows = [r for r in vrows if limit[0] <= r["verse"] <= limit[1]]
    if not vrows:
        raise HTTPException(status_code=404, detail="passage not found")

    verse_list = [
        Verse(verse=r["verse"], lines=[Line(**ln) for ln in json.loads(r["nodes_json"])["lines"]])
        for r in vrows
    ]
    hrows = conn.execute(
        "SELECT before_verse, kind, text FROM headings "
        "WHERE work_id=? AND osis_code=? AND chapter=? ORDER BY before_verse",
        (work_id, osis, chapter),
    ).fetchall()
    headings = [
        Heading(before_verse=h["before_verse"], kind=h["kind"], text=h["text"])
        for h in hrows
        if limit is None or limit[0] <= h["before_verse"] <= limit[1]
    ]
    return Passage(work_id=work_id, osis=osis, chapter=chapter, verses=verse_list, headings=headings)
