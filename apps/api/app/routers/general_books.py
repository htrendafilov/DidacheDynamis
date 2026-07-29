import json
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import settings
from ..db import get_conn
from ..models import GeneralBook, GeneralBookSection, Work

router = APIRouter(prefix=settings.API_V1, tags=["general books"])


@router.get("/books", response_model=list[Work])
def list_general_books(conn: sqlite3.Connection = Depends(get_conn)) -> list[Work]:
    rows = conn.execute(
        "SELECT id,type,language,title,abbrev,direction,versification,license,attribution,"
        "source_url,source_version,ai_context_policy "
        "FROM works WHERE type='book' ORDER BY title, id"
    ).fetchall()
    return [Work(**dict(row)) for row in rows]


@router.get("/book/{work_id}", response_model=GeneralBook)
def get_general_book(
    work_id: str, conn: sqlite3.Connection = Depends(get_conn)
) -> GeneralBook:
    work = conn.execute(
        "SELECT 1 FROM works WHERE id=? AND type='book'", (work_id,)
    ).fetchone()
    if work is None:
        raise HTTPException(status_code=404, detail="book not found")
    rows = conn.execute(
        "SELECT section_id,parent_id,sort_order,level,title,body_json "
        "FROM book_sections WHERE work_id=? ORDER BY sort_order",
        (work_id,),
    ).fetchall()
    nodes: dict[str, dict] = {
        row["section_id"]: {
            "section_id": row["section_id"],
            "title": row["title"],
            "level": row["level"],
            "body": json.loads(row["body_json"]),
            "children": [],
        }
        for row in rows
    }
    roots: list[dict] = []
    for row in rows:
        node = nodes[row["section_id"]]
        parent_id = row["parent_id"]
        if parent_id is None:
            roots.append(node)
        elif parent_id in nodes:
            nodes[parent_id]["children"].append(node)
        else:
            raise HTTPException(status_code=500, detail="book section tree is invalid")
    return GeneralBook(
        work_id=work_id,
        sections=[GeneralBookSection.model_validate(node) for node in roots],
    )
