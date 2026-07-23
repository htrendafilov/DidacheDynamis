import re
import sqlite3

from fastapi import APIRouter, Depends, Query

from .. import settings
from ..db import get_conn
from ..models import (
    BookSearchHit,
    BookSearchResult,
    SearchGroup,
    SearchHit,
    SearchResponse,
)

router = APIRouter(prefix=settings.API_V1, tags=["search"])

_TOKEN = re.compile(r"\w+", re.UNICODE)
# Canonical sort key + a stable tie-breaker so pages never duplicate or omit a hit. book_order/
# chapter/verse are stored as text in FTS5, so cast them to INTEGER to sort numerically.
_CANONICAL = (
    "CAST(book_order AS INTEGER), CAST(chapter AS INTEGER), CAST(verse AS INTEGER), work_id, ref"
)


def _fts_query(q: str) -> str | None:
    """Build a safe FTS5 MATCH string: AND of quoted tokens (avoids syntax injection)."""
    toks = _TOKEN.findall(q)
    if not toks:
        return None
    return " ".join(f'"{t}"' for t in toks)


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1, max_length=200),
    works: str | None = Query(None, description="comma-separated work ids to restrict to"),
    sort: str = Query("relevance", pattern="^(relevance|canonical)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_conn),
) -> SearchResponse:
    match = _fts_query(q)
    if match is None:
        empty = SearchGroup(type="bible", total=0, offset=offset, limit=limit, has_more=False, hits=[])
        return SearchResponse(query=q, sort=sort, total=0, groups=[empty])

    where = "bible_fts MATCH ?"
    params: list = [match]
    if works:
        ids = [w for w in works.split(",") if w]
        if ids:
            where += " AND work_id IN (%s)" % ",".join("?" * len(ids))
            params += ids

    total = conn.execute(f"SELECT count(*) FROM bible_fts WHERE {where}", params).fetchone()[0]

    order = f"bm25(bible_fts), {_CANONICAL}" if sort == "relevance" else _CANONICAL
    rows = conn.execute(
        f"SELECT ref, work_id, snippet(bible_fts, 0, '<b>', '</b>', '…', 10) AS snip "
        f"FROM bible_fts WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()

    hits: list[SearchHit] = []
    for r in rows:
        try:
            osis, ch, vs = r["ref"].rsplit(".", 2)
            chapter, verse = int(ch), int(vs)
        except (ValueError, KeyError):
            continue
        hits.append(
            SearchHit(
                work_id=r["work_id"],
                title=f"{osis} {chapter}:{verse}",
                snippet=r["snip"],
                osis=osis,
                chapter=chapter,
                verse=verse,
                ref=r["ref"],
            )
        )

    group = SearchGroup(
        type="bible",
        total=total,
        offset=offset,
        limit=limit,
        has_more=offset + len(hits) < total,
        hits=hits,
    )
    return SearchResponse(query=q, sort=sort, total=total, groups=[group])


@router.get("/search/books", response_model=BookSearchResult)
def search_books(
    q: str = Query(..., min_length=1, max_length=200),
    works: str | None = Query(None, description="comma-separated book work ids to restrict to"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    conn: sqlite3.Connection = Depends(get_conn),
) -> BookSearchResult:
    """Full-text search across General Book sections (their own tree, not verse refs)."""
    match = _fts_query(q)
    if match is None:
        return BookSearchResult(query=q, limit=limit, offset=offset, hits=[])

    sql = (
        "SELECT work_id, section_id, snippet(book_fts, 0, '<b>', '</b>', '…', 12) AS snip "
        "FROM book_fts WHERE book_fts MATCH ?"
    )
    params: list = [match]
    if works:
        ids = [w for w in works.split(",") if w]
        if ids:
            sql += " AND work_id IN (%s)" % ",".join("?" * len(ids))
            params += ids
    sql += " ORDER BY bm25(book_fts) LIMIT ? OFFSET ?"
    params += [limit, offset]

    raw = conn.execute(sql, params).fetchall()
    if not raw:
        return BookSearchResult(query=q, limit=limit, offset=offset, hits=[])

    # A leaf section's own title is often just its ordinal ("1"), so build a breadcrumb from its
    # ancestors' titles ("Chapter 1. Scripture › 1") to give each hit readable context.
    work_ids = sorted({r["work_id"] for r in raw})
    tree = {
        (row["work_id"], row["section_id"]): (row["parent_id"], row["title"])
        for row in conn.execute(
            "SELECT work_id, section_id, parent_id, title FROM book_sections "
            "WHERE work_id IN (%s)" % ",".join("?" * len(work_ids)),
            work_ids,
        )
    }

    def breadcrumb(work_id: str, section_id: str) -> str:
        titles: list[str] = []
        seen: set[str] = set()
        cur: str | None = section_id
        while cur is not None and (work_id, cur) in tree and cur not in seen:
            seen.add(cur)
            parent, title = tree[(work_id, cur)]
            titles.append(title)
            cur = parent
        return " › ".join(reversed(titles))

    hits = [
        BookSearchHit(
            work_id=r["work_id"],
            section_id=r["section_id"],
            title=breadcrumb(r["work_id"], r["section_id"]),
            snippet=r["snip"],
        )
        for r in raw
    ]
    return BookSearchResult(query=q, limit=limit, offset=offset, hits=hits)
