import re
import sqlite3

from fastapi import APIRouter, Depends, Query

from .. import settings
from ..db import get_conn
from ..models import SearchHit, SearchResult

router = APIRouter(prefix=settings.API_V1, tags=["search"])

_TOKEN = re.compile(r"\w+", re.UNICODE)


def _fts_query(q: str) -> str | None:
    """Build a safe FTS5 MATCH string: AND of quoted tokens (avoids syntax injection)."""
    toks = _TOKEN.findall(q)
    if not toks:
        return None
    return " ".join(f'"{t}"' for t in toks)


@router.get("/search", response_model=SearchResult)
def search(
    q: str = Query(..., min_length=1, max_length=200),
    works: str | None = Query(None, description="comma-separated work ids to restrict to"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_conn),
) -> SearchResult:
    match = _fts_query(q)
    if match is None:
        return SearchResult(query=q, limit=limit, offset=offset, hits=[])

    sql = (
        "SELECT ref, work_id, snippet(bible_fts, 0, '<b>', '</b>', '…', 10) AS snip "
        "FROM bible_fts WHERE bible_fts MATCH ?"
    )
    params: list = [match]
    if works:
        ids = [w for w in works.split(",") if w]
        if ids:
            sql += " AND work_id IN (%s)" % ",".join("?" * len(ids))
            params += ids
    sql += " ORDER BY bm25(bible_fts) LIMIT ? OFFSET ?"
    params += [limit, offset]

    hits: list[SearchHit] = []
    for r in conn.execute(sql, params).fetchall():
        try:
            osis, ch, vs = r["ref"].rsplit(".", 2)
            hits.append(
                SearchHit(work_id=r["work_id"], ref=r["ref"], osis=osis,
                          chapter=int(ch), verse=int(vs), snippet=r["snip"])
            )
        except (ValueError, KeyError):
            continue
    return SearchResult(query=q, limit=limit, offset=offset, hits=hits)
