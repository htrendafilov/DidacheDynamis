"""Strong's lexicon lookup (M8.2, plan/search_workspace.md §10.4).

One normalized id in, one entry out. Ids that are valid Strong's numbers but absent from
the imported modules (135 Greek key holes, e.g. G3778) 404 like any missing entry; the
client falls back to showing the bare identifier.
"""

from __future__ import annotations

import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import settings
from ..db import get_conn
from ..models import StrongEntry, StrongOccurrenceResponse, StrongSource
from ..search_providers import STRONGS_PROVIDER
from ..strongs import WORK_BY_LETTER, normalize_strong_id

router = APIRouter(prefix=settings.API_V1, tags=["lexicon"])


def _csv(value: str | None, cap: int, name: str) -> list[str] | None:
    if not value:
        return None
    items = [item for item in value.split(",") if item]
    if len(items) > cap:
        raise HTTPException(status_code=400, detail=f"too many {name} values")
    return items or None


@router.get("/lexicon/sources", response_model=list[StrongSource])
def strong_sources(conn: sqlite3.Connection = Depends(get_conn)) -> list[StrongSource]:
    """Annotated Bible works that can supply Strong's occurrence results."""
    return [StrongSource(work_id=work_id) for work_id in STRONGS_PROVIDER.source_ids(conn)]


@router.get("/lexicon/{strong_id}", response_model=StrongEntry)
def strong_entry(
    strong_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> StrongEntry:
    normalized = normalize_strong_id(strong_id)
    if normalized is None:
        raise HTTPException(status_code=400, detail="invalid Strong's identifier")
    row = conn.execute(
        "SELECT strong_id,language,lemma,transliteration,pronunciation,definition_json "
        "FROM strong_lexicon WHERE strong_id=?",
        (normalized,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="lexicon entry not found")
    definition = json.loads(row["definition_json"])
    return StrongEntry(
        strong_id=row["strong_id"],
        language=row["language"],
        work_id=WORK_BY_LETTER[normalized[0]],
        lemma=row["lemma"],
        transliteration=row["transliteration"],
        pronunciation=row["pronunciation"],
        definition=definition["text"],
        see=definition.get("see", []),
    )


@router.get(
    "/lexicon/{strong_id}/occurrences",
    response_model=StrongOccurrenceResponse,
)
def strong_occurrences(
    strong_id: str,
    verse_text: str | None = Query(None, min_length=1, max_length=200),
    works: str | None = Query(None),
    canon: str | None = Query(None, pattern="^(ot|nt)$"),
    books: str | None = Query(None),
    morph_scheme: str | None = Query(None, pattern="^(strongMorph|robinson)$"),
    morph: str | None = Query(None, min_length=1, max_length=40, pattern="^[A-Za-z0-9-]+$"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0, le=100_000),
    conn: sqlite3.Connection = Depends(get_conn),
) -> StrongOccurrenceResponse:
    normalized = normalize_strong_id(strong_id)
    if normalized is None:
        raise HTTPException(status_code=400, detail="invalid Strong's identifier")
    if (morph_scheme is None) != (morph is None):
        raise HTTPException(
            status_code=400, detail="morph_scheme and morph must be supplied together"
        )
    work_filter = _csv(works, 20, "works")
    book_filter = _csv(books, 66, "books")
    testament = {"ot": "OT", "nt": "NT"}.get(canon or "")
    total, occurrence_total, hits = STRONGS_PROVIDER.occurrence_page(
        conn,
        normalized,
        verse_text,
        work_filter,
        testament,
        book_filter,
        morph_scheme,
        morph,
        "canonical",
        limit,
        offset,
    )
    return StrongOccurrenceResponse(
        strong_id=normalized,
        total=total,
        occurrence_total=occurrence_total,
        offset=offset,
        limit=limit,
        has_more=offset + len(hits) < total,
        available_works=STRONGS_PROVIDER.source_ids(conn),
        hits=hits,
    )
