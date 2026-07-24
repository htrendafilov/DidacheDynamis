"""Per-content-type search providers over the source-specific FTS5 tables.

Each provider knows its table's locator/sort columns and normalizes matches into a typed hit. Bible
and commentary support testament/book filters (they carry canonical coordinates); dictionary and book
ignore those. Every FTS table holds only its own content type's works, so a work-id filter needs no
type join. bm25() weights the indexed headword/title columns above body text.
"""

from __future__ import annotations

import re
import sqlite3

from .models import BibleHit, BookHit, CommentaryHit, DictionaryHit

_TOKEN = re.compile(r"\w+", re.UNICODE)
ALL_TYPES = ("bible", "commentary", "dictionary", "book")
PREVIEW = 5  # per-group rows in a multi-type ("All") query


def fts_query(q: str) -> str | None:
    """Safe FTS5 MATCH string: AND of quoted tokens (no raw FTS syntax reaches SQLite)."""
    toks = _TOKEN.findall(q)
    return " ".join(f'"{t}"' for t in toks) if toks else None


def _in(col: str, values: list[str], params: list) -> str:
    params.extend(values)
    placeholders = ",".join("?" * len(values))
    return f" AND {col} IN ({placeholders})"


def resolve_work_ids(
    conn: sqlite3.Connection, type_: str, works: list[str] | None, languages: list[str] | None
) -> list[str] | None:
    """Effective work-id restriction for a content type, or None for no restriction.

    Returns an empty list when a language filter excludes every work of the type (→ no hits).
    """
    if languages:
        placeholders = ",".join("?" * len(languages))
        rows = conn.execute(
            f"SELECT id FROM works WHERE type=? AND language IN ({placeholders})",
            [type_, *languages],
        ).fetchall()
        ids = {r[0] for r in rows}
        return sorted(ids & set(works)) if works else sorted(ids)
    return list(works) if works else None


class _Provider:
    type: str
    table: str
    canonical: str  # ORDER BY key for source/canonical order (also the relevance tie-breaker)
    _bm25: str  # bm25() expression (with column weights where relevant)

    def _where(
        self, match: str, work_ids: list[str] | None, testament: str | None, books: list[str] | None
    ) -> tuple[str, list]:
        where = f"{self.table} MATCH ?"
        params: list = [match]
        if work_ids is not None:
            where += _in("work_id", work_ids, params)
        return where, params

    def count(self, conn, match, work_ids, testament, books) -> int:
        if work_ids is not None and not work_ids:
            return 0
        where, params = self._where(match, work_ids, testament, books)
        return conn.execute(f"SELECT count(*) FROM {self.table} WHERE {where}", params).fetchone()[0]

    def _rows(self, conn, match, work_ids, testament, books, select, sort, limit, offset):
        if work_ids is not None and not work_ids:
            return []
        where, params = self._where(match, work_ids, testament, books)
        order = f"{self._bm25}, {self.canonical}" if sort == "relevance" else self.canonical
        return conn.execute(
            f"SELECT {select} FROM {self.table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()


class _BibleProvider(_Provider):
    type = "bible"
    table = "bible_fts"
    canonical = "CAST(book_order AS INTEGER), CAST(chapter AS INTEGER), CAST(verse AS INTEGER), work_id, ref"
    _bm25 = "bm25(bible_fts)"

    def _where(self, match, work_ids, testament, books):
        where, params = super()._where(match, work_ids, testament, books)
        if testament:
            where += " AND testament = ?"
            params.append(testament)
        if books:
            where += _in("osis", books, params)
        return where, params

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = (
            "ref, work_id, osis, chapter, verse, "
            "snippet(bible_fts, 0, '<b>', '</b>', '…', 10) AS snip"
        )
        hits = []
        for r in self._rows(conn, match, work_ids, testament, books, select, sort, limit, offset):
            chapter, verse = int(r["chapter"]), int(r["verse"])
            hits.append(
                BibleHit(
                    work_id=r["work_id"],
                    title=f"{r['osis']} {chapter}:{verse}",
                    snippet=r["snip"],
                    osis=r["osis"],
                    chapter=chapter,
                    verse=verse,
                    ref=r["ref"],
                )
            )
        return hits


class _CommentaryProvider(_Provider):
    type = "commentary"
    table = "commentary_fts"
    canonical = (
        "CAST(book_order AS INTEGER), CAST(chapter AS INTEGER), "
        "CAST(verse_start AS INTEGER), CAST(entry_id AS INTEGER)"
    )
    _bm25 = "bm25(commentary_fts)"

    def _where(self, match, work_ids, testament, books):
        where, params = super()._where(match, work_ids, testament, books)
        if testament:
            where += " AND testament = ?"
            params.append(testament)
        if books:
            where += _in("osis", books, params)
        return where, params

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = (
            "entry_id, work_id, osis, chapter, verse_start, "
            "snippet(commentary_fts, 0, '<b>', '</b>', '…', 12) AS snip"
        )
        hits = []
        for r in self._rows(conn, match, work_ids, testament, books, select, sort, limit, offset):
            chapter, verse_start = int(r["chapter"]), int(r["verse_start"])
            ref = f"{r['osis']} {chapter}" + (f":{verse_start}" if verse_start else "")
            hits.append(
                CommentaryHit(
                    work_id=r["work_id"],
                    title=ref,
                    snippet=r["snip"],
                    osis=r["osis"],
                    chapter=chapter,
                    verse_start=verse_start,
                    entry_id=int(r["entry_id"]),
                )
            )
        return hits


class _DictionaryProvider(_Provider):
    type = "dictionary"
    table = "dictionary_fts"
    canonical = "sort_key, headword"
    _bm25 = "bm25(dictionary_fts, 1.0, 5.0)"  # weight the headword column above the body

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = (
            "work_id, headword, snippet(dictionary_fts, 0, '<b>', '</b>', '…', 12) AS snip"
        )
        return [
            DictionaryHit(
                work_id=r["work_id"], title=r["headword"], snippet=r["snip"], headword=r["headword"]
            )
            for r in self._rows(conn, match, work_ids, testament, books, select, sort, limit, offset)
        ]


class _BookProvider(_Provider):
    type = "book"
    table = "book_fts"
    canonical = "CAST(sort_order AS INTEGER), section_id"
    _bm25 = "bm25(book_fts, 1.0, 5.0)"  # weight the title column above the body

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = (
            "work_id, section_id, snippet(book_fts, 0, '<b>', '</b>', '…', 12) AS snip"
        )
        rows = self._rows(conn, match, work_ids, testament, books, select, sort, limit, offset)
        breadcrumbs = _book_breadcrumbs(conn, {r["work_id"] for r in rows})
        return [
            BookHit(
                work_id=r["work_id"],
                title=breadcrumbs.get((r["work_id"], r["section_id"]), r["section_id"]),
                snippet=r["snip"],
                section_id=r["section_id"],
            )
            for r in rows
        ]


def _book_breadcrumbs(conn, work_ids: set[str]) -> dict[tuple[str, str], str]:
    """Map (work_id, section_id) -> "Chapter › Section" breadcrumb from the section tree."""
    if not work_ids:
        return {}
    placeholders = ",".join("?" * len(work_ids))
    tree = {
        (row["work_id"], row["section_id"]): (row["parent_id"], row["title"])
        for row in conn.execute(
            "SELECT work_id, section_id, parent_id, title FROM book_sections "
            f"WHERE work_id IN ({placeholders})",
            sorted(work_ids),
        )
    }
    out: dict[tuple[str, str], str] = {}
    for work_id, section_id in tree:
        titles: list[str] = []
        seen: set[str] = set()
        cur: str | None = section_id
        while cur is not None and (work_id, cur) in tree and cur not in seen:
            seen.add(cur)
            parent, title = tree[(work_id, cur)]
            titles.append(title)
            cur = parent
        out[(work_id, section_id)] = " › ".join(reversed(titles))
    return out


PROVIDERS: dict[str, _Provider] = {
    p.type: p for p in (_BibleProvider(), _CommentaryProvider(), _DictionaryProvider(), _BookProvider())
}
