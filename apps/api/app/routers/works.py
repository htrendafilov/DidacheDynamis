import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import settings
from ..db import content_version, get_conn
from ..models import Book, Meta, TranslationProvenance, Work

router = APIRouter(prefix=settings.API_V1, tags=["works"])


def _provenance_from_row(row: sqlite3.Row) -> TranslationProvenance:
    return TranslationProvenance(
        provenance_id=row["provenance_id"],
        model_request_id=row["model_request_id"],
        model_canonical_slug=row["model_canonical_slug"],
        model_returned=row["model_returned"],
        prompt_hash=row["prompt_hash"],
        glossary_hash=row["glossary_hash"],
        settings_json=row["settings_json"],
        run_id=row["run_id"],
        translated_at=row["translated_at"],
    )


@router.get("/meta", response_model=Meta)
def meta(conn: sqlite3.Connection = Depends(get_conn)) -> Meta:
    n = conn.execute("SELECT count(*) FROM works").fetchone()[0]
    return Meta(content_version=content_version(), works=n)


@router.get("/works", response_model=list[Work])
def list_works(conn: sqlite3.Connection = Depends(get_conn)) -> list[Work]:
    rows = conn.execute(
        "SELECT id,type,language,title,abbrev,direction,versification,license,attribution,"
        "source_url,source_version,ai_context_policy,quality_label "
        "FROM works ORDER BY type, id"
    ).fetchall()
    works: list[Work] = []
    for r in rows:
        data = dict(r)
        summary: list[TranslationProvenance] | None = None
        if data["type"] == "commentary":
            prov_rows = conn.execute(
                "SELECT DISTINCT p.provenance_id, p.model_request_id, p.model_canonical_slug, "
                "p.model_returned, p.prompt_hash, p.glossary_hash, p.settings_json, "
                "p.run_id, p.translated_at "
                "FROM translation_provenance p "
                "WHERE p.provenance_id IN ("
                "  SELECT provenance_id FROM commentary_entries WHERE work_id=?"
                "  UNION "
                "  SELECT bp.provenance_id FROM commentary_block_provenance bp "
                "  WHERE bp.work_id=?"
                ") "
                "ORDER BY p.provenance_id",
                (data["id"], data["id"]),
            ).fetchall()
            if prov_rows:
                summary = [_provenance_from_row(pr) for pr in prov_rows]
        works.append(
            Work(
                id=data["id"],
                type=data["type"],
                language=data["language"],
                title=data["title"],
                abbrev=data["abbrev"],
                direction=data["direction"],
                versification=data["versification"],
                license=data["license"],
                attribution=data["attribution"],
                source_url=data["source_url"],
                source_version=data["source_version"],
                ai_context_policy=data["ai_context_policy"],
                quality_label=data["quality_label"],
                provenance_summary=summary,
            )
        )
    return works


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
