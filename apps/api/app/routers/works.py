import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import settings
from ..db import content_version, get_conn
from ..models import Book, Meta, Work

router = APIRouter(prefix=settings.API_V1, tags=["works"])


@router.get("/meta", response_model=Meta)
def meta(conn: sqlite3.Connection = Depends(get_conn)) -> Meta:
    n = conn.execute("SELECT count(*) FROM works").fetchone()[0]
    return Meta(content_version=content_version(), works=n)


@router.get("/works", response_model=list[Work])
def list_works(conn: sqlite3.Connection = Depends(get_conn)) -> list[Work]:
    rows = conn.execute(
        "SELECT id,type,language,title,abbrev,direction,versification,license,attribution "
        "FROM works ORDER BY type, id"
    ).fetchall()
    return [Work(**dict(r)) for r in rows]


@router.get("/works/{work_id}/books", response_model=list[Book])
def list_books(work_id: str, conn: sqlite3.Connection = Depends(get_conn)) -> list[Book]:
    rows = conn.execute(
        "SELECT osis_code,name,sort_order,chapter_count FROM books "
        "WHERE work_id=? ORDER BY sort_order",
        (work_id,),
    ).fetchall()
    if not rows:
        raise HTTPException(status_code=404, detail="work not found")
    return [
        Book(osis=r["osis_code"], name=r["name"], order=r["sort_order"],
             chapter_count=r["chapter_count"])
        for r in rows
    ]
