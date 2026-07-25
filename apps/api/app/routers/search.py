import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import SearchGroup, SearchResponse
from ..search_providers import ALL_TYPES, PREVIEW, PROVIDERS, fts_query, resolve_work_ids

router = APIRouter(prefix=settings.API_V1, tags=["search"])

_TESTAMENT = {"ot": "OT", "nt": "NT"}


def _csv(value: str | None, cap: int, name: str) -> list[str] | None:
    if not value:
        return None
    items = [v for v in value.split(",") if v]
    if len(items) > cap:
        raise HTTPException(status_code=400, detail=f"too many {name} values")
    return items or None


@router.get("/search", response_model=SearchResponse)
def search(
    q: str = Query(..., min_length=1, max_length=200),
    refine: str | None = Query(
        None,
        min_length=1,
        max_length=200,
        description="additional terms ANDed with the primary query",
    ),
    types: str | None = Query(None, description="content types, e.g. bible,commentary"),
    works: str | None = Query(None, description="restrict to these work ids"),
    canon: str | None = Query(None, pattern="^(ot|nt)$", description="testament filter"),
    books: str | None = Query(None, description="restrict Bible/commentary to these OSIS books"),
    languages: str | None = Query(None, description="restrict to these content languages"),
    sort: str = Query("relevance", pattern="^(relevance|canonical)$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    conn: sqlite3.Connection = Depends(get_conn),
) -> SearchResponse:
    requested = _csv(types, len(ALL_TYPES), "types") or list(ALL_TYPES)
    unknown = next((t for t in requested if t not in PROVIDERS), None)
    if unknown is not None:
        raise HTTPException(status_code=400, detail=f"unknown content type: {unknown}")
    requested = [t for i, t in enumerate(requested) if t not in requested[:i]]  # dedupe, keep order

    work_filter = _csv(works, 20, "works")
    book_filter = _csv(books, 66, "books")
    language_filter = _csv(languages, 10, "languages")
    testament = _TESTAMENT.get(canon or "")

    # A multi-type ("All") query returns a small preview per group; a single-type query paginates it.
    preview = len(requested) > 1
    match = fts_query(q)
    refine_match = fts_query(refine) if refine else None
    if match is not None and refine_match is not None:
        match = f"{match} {refine_match}"

    groups: list[SearchGroup] = []
    grand_total = 0
    for content_type in requested:
        provider = PROVIDERS[content_type]
        group_limit, group_offset = (PREVIEW, 0) if preview else (limit, offset)
        if match is None:
            groups.append(
                SearchGroup(
                    type=content_type,
                    total=0,
                    offset=group_offset,
                    limit=group_limit,
                    has_more=False,
                    hits=[],
                )
            )
            continue
        work_ids = resolve_work_ids(conn, content_type, work_filter, language_filter)
        total = provider.count(conn, match, work_ids, testament, book_filter)
        hits = provider.page(
            conn, match, work_ids, testament, book_filter, sort, group_limit, group_offset
        )
        grand_total += total
        groups.append(
            SearchGroup(
                type=content_type,
                total=total,
                offset=group_offset,
                limit=group_limit,
                has_more=group_offset + len(hits) < total,
                hits=hits,
            )
        )

    return SearchResponse(query=q, refine=refine, sort=sort, total=grand_total, groups=groups)
