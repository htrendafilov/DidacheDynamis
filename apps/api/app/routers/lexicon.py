"""Strong's lexicon lookup (M8.2, plan/search_workspace.md §10.4).

One normalized id in, one entry out. Ids that are valid Strong's numbers but absent from
the imported modules (135 Greek key holes, e.g. G3778) 404 like any missing entry; the
client falls back to showing the bare identifier.
"""

from __future__ import annotations

import json
import re
import sqlite3

from fastapi import APIRouter, Depends, HTTPException

from .. import settings
from ..db import get_conn
from ..models import StrongEntry

router = APIRouter(prefix=settings.API_V1, tags=["lexicon"])

# Same canonical form as bibleimport.canonical.normalize_strong_id (intentionally
# duplicated: the production API package does not depend on the offline importer).
# Five digits cover the KJV source's extra leading-zero padding (e.g. H07225) while
# bounding public input before int conversion.
_STRONG_ID = re.compile(r"^(?P<letter>[HGhg])(?P<number>[0-9]{1,5})(?P<suffix>[A-Za-z]?)$")
# The id's leading letter partitions the namespace and is already validated, so work_id
# does not depend on the language column having exactly the expected values.
_WORK_BY_LETTER = {"G": "strongsgreek", "H": "strongshebrew"}


def _normalize_strong_id(value: str) -> str | None:
    match = _STRONG_ID.match(value.strip())
    if not match:
        return None
    return (
        f"{match.group('letter').upper()}"
        f"{int(match.group('number')):04d}"
        f"{match.group('suffix').upper()}"
    )


@router.get("/lexicon/{strong_id}", response_model=StrongEntry)
def strong_entry(
    strong_id: str,
    conn: sqlite3.Connection = Depends(get_conn),
) -> StrongEntry:
    normalized = _normalize_strong_id(strong_id)
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
        work_id=_WORK_BY_LETTER[normalized[0]],
        lemma=row["lemma"],
        transliteration=row["transliteration"],
        pronunciation=row["pronunciation"],
        definition=definition["text"],
        see=definition.get("see", []),
    )
