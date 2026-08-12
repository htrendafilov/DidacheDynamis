"""Per-content-type search providers over the source-specific FTS5 tables.

Each provider knows its table's locator/sort columns and normalizes matches into a typed hit. Bible
and commentary support testament/book filters (they carry canonical coordinates); dictionary and book
ignore those. Every FTS table holds only its own content type's works, so a work-id filter needs no
type join. bm25() weights the indexed headword/title columns above body text.
"""

from __future__ import annotations

import json
import re
import sqlite3

from .models import (
    BibleHit,
    BookHit,
    CommentaryHit,
    DictionaryHit,
    StrongMorphology,
    StrongsEntryHit,
    StrongsOccurrenceHit,
)
from .strongs import (
    WORK_BY_LETTER,
    lexical_tokens,
    normalize_lexical_search,
    normalize_strong_id,
)

_TOKEN = re.compile(r"\w+", re.UNICODE)
ALL_TYPES = ("bible", "commentary", "dictionary", "book", "strongs")
PREVIEW = 5  # per-group rows in a multi-type ("All") query
DEFINITION_EXCERPT = 240  # characters of a Strong's definition kept in an entry card
VERSE_EXCERPT = 200  # characters of verse text kept in a Strong's occurrence row


def fts_query(q: str) -> str | None:
    """Safe FTS5 MATCH string: AND of quoted tokens (no raw FTS syntax reaches SQLite)."""
    toks = _TOKEN.findall(q)
    return " ".join(f'"{t}"' for t in toks) if toks else None


def _excerpt(text: str, limit: int, needle: str | None = None) -> str:
    """Bounded, word-aligned excerpt of a longer body of text.

    Strong's occurrence rows quote `verses.plain_text`, which is a whole verse rather than
    an FTS `snippet()` window, so long verses would otherwise dominate a 50-row concordance.
    When `needle` (the tagged surface form) is given, the window is centred on its first
    use so the word the row is about is always visible.
    """
    if len(text) <= limit:
        return text
    start = 0
    if needle:
        found = text.casefold().find(needle.casefold())
        if found > 0:
            start = max(0, found - limit // 3)
    excerpt = text[start : start + limit]
    if start + limit < len(text):
        excerpt = excerpt.rsplit(" ", 1)[0] + "…"
    if start > 0:
        head, _, rest = excerpt.partition(" ")
        excerpt = "…" + (rest or head)
    return excerpt


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
        return conn.execute(f"SELECT count(*) FROM {self.table} WHERE {where}", params).fetchone()[
            0
        ]

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
    # coalesce, not a bare CAST: a chapter introduction has a NULL verse and must sort first
    # within its chapter. SQLite happens to place NULLs first in ASC anyway, but relying on that
    # leaves the ordering silently dependent on it — this matches routers/commentary.py.
    # Tie-break with work_id so cross-work pages are deterministic when entry_id overlaps.
    canonical = (
        "CAST(book_order AS INTEGER), CAST(chapter AS INTEGER), "
        "coalesce(CAST(verse_start AS INTEGER), 0), work_id, CAST(entry_id AS INTEGER)"
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
        # Join entries for unit_id / release / provenance (M2 durable identity).
        select = (
            "commentary_fts.entry_id AS entry_id, commentary_fts.work_id AS work_id, "
            "commentary_fts.osis AS osis, commentary_fts.chapter AS chapter, "
            "commentary_fts.verse_start AS verse_start, "
            "snippet(commentary_fts, 0, '<b>', '</b>', '…', 12) AS snip"
        )
        hits = []
        for r in self._rows(conn, match, work_ids, testament, books, select, sort, limit, offset):
            chapter = int(r["chapter"])
            raw_verse = r["verse_start"]
            # A chapter introduction stores NULL here. int(None) is a TypeError, so this must
            # stay a None check rather than a truthiness one.
            verse_start = None if raw_verse is None else int(raw_verse)
            ref = f"{r['osis']} {chapter}" + (f":{verse_start}" if verse_start else "")
            entry_id = int(r["entry_id"])
            work_id = r["work_id"]
            meta = conn.execute(
                "SELECT unit_id, release_version, provenance_id FROM commentary_entries "
                "WHERE work_id=? AND entry_id=?",
                (work_id, entry_id),
            ).fetchone()
            hits.append(
                CommentaryHit(
                    work_id=work_id,
                    title=ref,
                    snippet=r["snip"],
                    osis=r["osis"],
                    chapter=chapter,
                    verse_start=verse_start,
                    is_chapter_introduction=verse_start is None,
                    entry_id=entry_id,
                    unit_id=meta["unit_id"] if meta else None,
                    release_version=meta["release_version"] if meta else None,
                    provenance_id=meta["provenance_id"] if meta else None,
                )
            )
        return hits


class _DictionaryProvider(_Provider):
    type = "dictionary"
    table = "dictionary_fts"
    canonical = "sort_key, headword"
    _bm25 = "bm25(dictionary_fts, 1.0, 5.0)"  # weight the headword column above the body

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = "work_id, headword, snippet(dictionary_fts, 0, '<b>', '</b>', '…', 12) AS snip"
        return [
            DictionaryHit(
                work_id=r["work_id"], title=r["headword"], snippet=r["snip"], headword=r["headword"]
            )
            for r in self._rows(
                conn, match, work_ids, testament, books, select, sort, limit, offset
            )
        ]


class _BookProvider(_Provider):
    type = "book"
    table = "book_fts"
    canonical = "CAST(sort_order AS INTEGER), section_id"
    _bm25 = "bm25(book_fts, 1.0, 5.0)"  # weight the title column above the body

    def page(self, conn, match, work_ids, testament, books, sort, limit, offset):
        select = "work_id, section_id, snippet(book_fts, 0, '<b>', '</b>', '…', 12) AS snip"
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
    p.type: p
    for p in (_BibleProvider(), _CommentaryProvider(), _DictionaryProvider(), _BookProvider())
}


class StrongsSearchProvider:
    """Structured Strong's entry and occurrence search (M8.4).

    Lexicon text is searched through importer-populated, case/diacritic-folded shadow
    columns. Occurrences stay grouped by Strong's id + verse so total/offset pagination
    cannot split repeated uses of an id inside one verse.
    """

    type = "strongs"

    def available(self, conn: sqlite3.Connection) -> bool:
        lexicon = conn.execute("SELECT EXISTS(SELECT 1 FROM strong_lexicon)").fetchone()[0]
        tokens = conn.execute(
            "SELECT EXISTS(SELECT 1 FROM verse_tokens WHERE strong_id IS NOT NULL)"
        ).fetchone()[0]
        return bool(lexicon and tokens)

    def source_ids(self, conn: sqlite3.Connection) -> list[str]:
        """Annotated Bible work ids, driven from `works` rather than `verse_tokens`.

        `SELECT DISTINCT work_id FROM verse_tokens` reads as the obvious query but costs a
        full index scan (~80 ms over a KJV-sized table) because the build does not ANALYZE,
        so the planner cannot skip to the next distinct value. Iterating the handful of
        Bible works and probing each with EXISTS seeks the verse_tokens primary key and
        stops at the first tagged row instead.
        """
        return [
            row[0]
            for row in conn.execute(
                "SELECT id FROM works WHERE type='bible' AND EXISTS("
                "SELECT 1 FROM verse_tokens t WHERE t.work_id=works.id "
                "AND t.strong_id IS NOT NULL) ORDER BY id"
            )
        ]

    def _lexical_predicate(self, query: str, alias: str = "l") -> tuple[str, list[str], str | None]:
        exact = normalize_strong_id(query)
        if exact is not None:
            return f"{alias}.strong_id = ?", [exact], exact
        tokens = lexical_tokens(query)
        if not tokens:
            return "0", [], None
        clauses: list[str] = []
        params: list[str] = []
        for token in tokens:
            clauses.append(
                f"(instr({alias}.lemma_search, ?) > 0 "
                f"OR instr(COALESCE({alias}.transliteration_search, ''), ?) > 0 "
                f"OR instr({alias}.definition_search, ?) > 0)"
            )
            params.extend((token, token, token))
        return " AND ".join(clauses), params, None

    def _relevance(self, query: str, alias: str = "l") -> tuple[str, list[str]]:
        folded = normalize_lexical_search(query)
        exact = normalize_strong_id(query)
        if exact is not None:
            return f"CASE WHEN {alias}.strong_id = ? THEN 0 ELSE 6 END", [exact]
        expression = (
            "CASE "
            f"WHEN {alias}.lemma_search = ? THEN 1 "
            f"WHEN COALESCE({alias}.transliteration_search, '') = ? THEN 2 "
            f"WHEN instr({alias}.lemma_search, ?) = 1 THEN 3 "
            f"WHEN instr(COALESCE({alias}.transliteration_search, ''), ?) = 1 THEN 4 "
            "ELSE 5 END"
        )
        return expression, [folded, folded, folded, folded]

    @staticmethod
    def _token_scope(
        work_ids: list[str] | None,
        testament: str | None,
        books: list[str] | None,
    ) -> tuple[str, str, list[str]]:
        joins = ""
        clauses: list[str] = []
        params: list[str] = []
        if work_ids is not None:
            if not work_ids:
                clauses.append("0")
            else:
                placeholders = ",".join("?" * len(work_ids))
                clauses.append(f"t.work_id IN ({placeholders})")
                params.extend(work_ids)
        if testament:
            joins = (
                "JOIN books scope_book ON scope_book.work_id=t.work_id "
                "AND scope_book.osis_code=t.osis_code "
            )
            clauses.append(
                "scope_book.sort_order <= 39" if testament == "OT" else "scope_book.sort_order > 39"
            )
        if books:
            placeholders = ",".join("?" * len(books))
            clauses.append(f"t.osis_code IN ({placeholders})")
            params.extend(books)
        return joins, " AND ".join(clauses), params

    def _entry_counts(
        self,
        conn: sqlite3.Connection,
        strong_ids: list[str],
        work_ids: list[str] | None,
        testament: str | None,
        books: list[str] | None,
    ) -> dict[str, tuple[int, int]]:
        if not strong_ids:
            return {}
        joins, scope, scope_params = self._token_scope(work_ids, testament, books)
        placeholders = ",".join("?" * len(strong_ids))
        where = f"t.strong_id IN ({placeholders})"
        if scope:
            where += f" AND {scope}"
        rows = conn.execute(
            "SELECT strong_id,SUM(occurrence_count),COUNT(*) FROM ("
            "SELECT t.strong_id,COUNT(*) AS occurrence_count FROM verse_tokens t "
            f"{joins}WHERE {where} "
            "GROUP BY t.strong_id,t.work_id,t.osis_code,t.chapter,t.verse"
            ") GROUP BY strong_id",
            [*strong_ids, *scope_params],
        ).fetchall()
        return {row[0]: (int(row[1]), int(row[2])) for row in rows}

    def entry_page(
        self,
        conn: sqlite3.Connection,
        query: str,
        work_ids: list[str] | None,
        languages: list[str] | None,
        testament: str | None,
        books: list[str] | None,
        sort: str,
        limit: int,
        offset: int,
    ) -> tuple[int, list[StrongsEntryHit]]:
        predicate, predicate_params, exact = self._lexical_predicate(query)
        where = predicate
        where_params: list[str] = list(predicate_params)
        if languages:
            placeholders = ",".join("?" * len(languages))
            where += f" AND l.language IN ({placeholders})"
            where_params.extend(languages)
        source_restricted = work_ids is not None or testament is not None or bool(books)
        restriction = ""
        scope_params: list[str] = []
        if source_restricted:
            scope_joins, scope, scope_params = self._token_scope(work_ids, testament, books)
            restriction = (
                " AND EXISTS(SELECT 1 FROM verse_tokens t "
                f"{scope_joins}WHERE t.strong_id=l.strong_id"
                f"{f' AND {scope}' if scope else ''})"
            )
        total = conn.execute(
            f"SELECT count(*) FROM strong_lexicon l WHERE {where}{restriction}",
            [*where_params, *scope_params],
        ).fetchone()[0]

        # A valid KJV id can be absent from the lexicon module. Preserve direct-id
        # occurrence discovery with a synthetic entry card instead of reporting no result.
        if total == 0 and exact is not None:
            language = "grc" if exact.startswith("G") else "hbo"
            if languages and language not in languages:
                return 0, []
            verse_total, occurrence_total, _ = self.occurrence_page(
                conn,
                exact,
                None,
                work_ids,
                languages,
                testament,
                books,
                None,
                None,
                "canonical",
                1,
                0,
            )
            if occurrence_total == 0:
                return 0, []
            hit = StrongsEntryHit(
                work_id=WORK_BY_LETTER[exact[0]],
                title=exact,
                snippet="",
                strong_id=exact,
                language=None,
                lemma=None,
                transliteration=None,
                occurrence_count=occurrence_total,
                verse_count=verse_total,
            )
            return (1, [hit] if offset == 0 else [])

        relevance, relevance_params = self._relevance(query)
        order = "l.strong_id" if sort == "canonical" else "rank, l.strong_id"
        rows = conn.execute(
            "SELECT l.strong_id,l.language,l.lemma,l.transliteration,l.definition_json,"
            f"{relevance} AS rank FROM strong_lexicon l WHERE {where}{restriction} "
            f"ORDER BY {order} LIMIT ? OFFSET ?",
            [*relevance_params, *where_params, *scope_params, limit, offset],
        ).fetchall()
        counts = self._entry_counts(
            conn,
            [row["strong_id"] for row in rows],
            work_ids,
            testament,
            books,
        )
        hits: list[StrongsEntryHit] = []
        for row in rows:
            snippet = _excerpt(json.loads(row["definition_json"])["text"], DEFINITION_EXCERPT)
            occurrence_count, verse_count = counts.get(row["strong_id"], (0, 0))
            hits.append(
                StrongsEntryHit(
                    work_id=WORK_BY_LETTER[row["strong_id"][0]],
                    title=f"{row['strong_id']} · {row['lemma']}",
                    snippet=snippet,
                    strong_id=row["strong_id"],
                    language=row["language"],
                    lemma=row["lemma"],
                    transliteration=row["transliteration"],
                    occurrence_count=occurrence_count,
                    verse_count=verse_count,
                )
            )
        return int(total), hits

    def _lexical_cte(self, query: str, languages: list[str] | None) -> tuple[str, list[str]] | None:
        """The Strong's ids an occurrence query matches, or None when none can match.

        An exact id resolves without consulting `strong_lexicon`, so a valid KJV id absent
        from the installed modules still has a concordance. Its language therefore comes
        from the id letter rather than a lexicon row.
        """
        exact = normalize_strong_id(query)
        if exact is not None:
            if languages and ("grc" if exact.startswith("G") else "hbo") not in languages:
                return None
            return "SELECT ? AS strong_id, 0 AS rank", [exact]
        predicate, predicate_params, _ = self._lexical_predicate(query)
        relevance, relevance_params = self._relevance(query)
        params = [*relevance_params, *predicate_params]
        if languages:
            placeholders = ",".join("?" * len(languages))
            predicate += f" AND l.language IN ({placeholders})"
            params.extend(languages)
        return (
            f"SELECT l.strong_id,{relevance} AS rank FROM strong_lexicon l WHERE {predicate}",
            params,
        )

    @staticmethod
    def _occurrence_where(
        verse_text: str | None,
        work_ids: list[str] | None,
        testament: str | None,
        books: list[str] | None,
        morph_scheme: str | None,
        morph_code: str | None,
    ) -> tuple[str, list[str]] | None:
        clauses = ["t.strong_id IS NOT NULL"]
        params: list[str] = []
        if verse_text:
            match = fts_query(verse_text)
            if match is None:
                return None
            clauses.append("bible_fts MATCH ?")
            params.append(match)
        if work_ids is not None:
            if not work_ids:
                clauses.append("0")
            else:
                placeholders = ",".join("?" * len(work_ids))
                clauses.append(f"t.work_id IN ({placeholders})")
                params.extend(work_ids)
        if testament:
            clauses.append("b.sort_order <= 39" if testament == "OT" else "b.sort_order > 39")
        if books:
            placeholders = ",".join("?" * len(books))
            clauses.append(f"t.osis_code IN ({placeholders})")
            params.extend(books)
        if morph_scheme and morph_code:
            clauses.extend(("t.morph_scheme = ?", "upper(t.morph_code) = upper(?)"))
            params.extend((morph_scheme, morph_code))
        return " AND ".join(clauses), params

    def occurrence_page(
        self,
        conn: sqlite3.Connection,
        query: str,
        verse_text: str | None,
        work_ids: list[str] | None,
        languages: list[str] | None,
        testament: str | None,
        books: list[str] | None,
        morph_scheme: str | None,
        morph_code: str | None,
        sort: str,
        limit: int,
        offset: int,
    ) -> tuple[int, int, list[StrongsOccurrenceHit]]:
        lexical = self._lexical_cte(query, languages)
        if lexical is None:
            return 0, 0, []
        lexical_sql, lexical_params = lexical
        occurrence_where = self._occurrence_where(
            verse_text, work_ids, testament, books, morph_scheme, morph_code
        )
        if occurrence_where is None:
            return 0, 0, []
        where, where_params = occurrence_where
        fts_join = ""
        if verse_text:
            fts_join = (
                "JOIN bible_fts ON bible_fts.work_id=t.work_id "
                "AND bible_fts.osis=t.osis_code "
                "AND CAST(bible_fts.chapter AS INTEGER)=t.chapter "
                "AND CAST(bible_fts.verse AS INTEGER)=t.verse "
            )
        from_sql = (
            "FROM lexical JOIN verse_tokens t ON t.strong_id=lexical.strong_id "
            "JOIN verses v ON v.work_id=t.work_id AND v.osis_code=t.osis_code "
            "AND v.chapter=t.chapter AND v.verse=t.verse "
            "JOIN books b ON b.work_id=t.work_id AND b.osis_code=t.osis_code "
            f"{fts_join}"
            f"WHERE {where}"
        )
        grouped = (
            "SELECT COUNT(*) AS occurrence_count "
            f"{from_sql} GROUP BY t.work_id,t.strong_id,t.osis_code,t.chapter,t.verse"
        )
        totals = conn.execute(
            f"WITH lexical AS ({lexical_sql}) "
            f"SELECT count(*),COALESCE(sum(occurrence_count),0) FROM ({grouped})",
            [*lexical_params, *where_params],
        ).fetchone()
        total, occurrence_total = int(totals[0]), int(totals[1])
        if total == 0:
            return 0, 0, []

        canonical = "b.sort_order,t.chapter,t.verse,t.work_id,t.strong_id"
        order = canonical if sort == "canonical" else f"MIN(lexical.rank),{canonical}"
        rows = conn.execute(
            f"WITH lexical AS ({lexical_sql}) "
            "SELECT t.work_id,t.strong_id,t.osis_code,t.chapter,t.verse,"
            "MIN(v.plain_text) AS snippet,COUNT(*) AS occurrence_count "
            f"{from_sql} "
            "GROUP BY t.work_id,t.strong_id,t.osis_code,t.chapter,t.verse,"
            f"b.sort_order ORDER BY {order} LIMIT ? OFFSET ?",
            [*lexical_params, *where_params, limit, offset],
        ).fetchall()

        details: dict[tuple[str, str, str, int, int], tuple[list[str], list[StrongMorphology]]] = {}
        if rows:
            key_clauses: list[str] = []
            detail_params: list[str | int] = []
            for row in rows:
                key_clauses.append(
                    "(work_id=? AND strong_id=? AND osis_code=? AND chapter=? AND verse=?)"
                )
                detail_params.extend(
                    (
                        row["work_id"],
                        row["strong_id"],
                        row["osis_code"],
                        int(row["chapter"]),
                        int(row["verse"]),
                    )
                )
            detail_where = f"({' OR '.join(key_clauses)})"
            if morph_scheme and morph_code:
                detail_where += " AND morph_scheme=? AND upper(morph_code)=upper(?)"
                detail_params.extend((morph_scheme, morph_code))
            for token in conn.execute(
                "SELECT work_id,strong_id,osis_code,chapter,verse,surface,"
                "morph_scheme,morph_code FROM verse_tokens "
                f"WHERE {detail_where} ORDER BY work_id,osis_code,chapter,verse,"
                "strong_id,position,ordinal",
                detail_params,
            ):
                key = (
                    token["work_id"],
                    token["strong_id"],
                    token["osis_code"],
                    int(token["chapter"]),
                    int(token["verse"]),
                )
                surfaces, morphology = details.setdefault(key, ([], []))
                surfaces.append(token["surface"])
                if token["morph_scheme"] and token["morph_code"]:
                    value = StrongMorphology(scheme=token["morph_scheme"], code=token["morph_code"])
                    if value not in morphology:
                        morphology.append(value)

        hits: list[StrongsOccurrenceHit] = []
        for row in rows:
            chapter, verse = int(row["chapter"]), int(row["verse"])
            key = (
                row["work_id"],
                row["strong_id"],
                row["osis_code"],
                chapter,
                verse,
            )
            surfaces, morphology = details.get(key, ([], []))
            hits.append(
                StrongsOccurrenceHit(
                    work_id=row["work_id"],
                    title=f"{row['osis_code']} {chapter}:{verse}",
                    snippet=_excerpt(
                        row["snippet"], VERSE_EXCERPT, surfaces[0] if surfaces else None
                    ),
                    strong_id=row["strong_id"],
                    osis=row["osis_code"],
                    chapter=chapter,
                    verse=verse,
                    ref=f"{row['osis_code']}.{chapter}.{verse}",
                    surfaces=surfaces,
                    occurrence_count=int(row["occurrence_count"]),
                    morphology=morphology,
                )
            )
        return total, occurrence_total, hits


STRONGS_PROVIDER = StrongsSearchProvider()
