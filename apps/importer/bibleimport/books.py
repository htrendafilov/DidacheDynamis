"""Canonical 66-book table: maps source (USFM/Paratext) codes to stable OSIS codes,
canonical order, and English display names. This is the single reference space every
translation aligns to (see plan/00_system_design.md §4).
"""

from __future__ import annotations

from dataclasses import dataclass


# Canon-group boundary for the current Protestant 66-book canon. Defined here (the single canon
# reference), not in the frontend or the search API, so a future canon profile changes it in one place.
OT_MAX_ORDER = 39


@dataclass(frozen=True)
class CanonBook:
    usfm: str  # source code used by USFX/USFM/Paratext, e.g. "GEN", "JHN"
    osis: str  # stable canonical code used everywhere in our data, e.g. "Gen", "John"
    order: int  # 1..66
    name_en: str

    @property
    def testament(self) -> str:
        return "OT" if self.order <= OT_MAX_ORDER else "NT"


# Protestant 66-book canon, in canonical order.
_CANON: list[tuple[str, str, str]] = [
    ("GEN", "Gen", "Genesis"), ("EXO", "Exod", "Exodus"), ("LEV", "Lev", "Leviticus"),
    ("NUM", "Num", "Numbers"), ("DEU", "Deut", "Deuteronomy"), ("JOS", "Josh", "Joshua"),
    ("JDG", "Judg", "Judges"), ("RUT", "Ruth", "Ruth"), ("1SA", "1Sam", "1 Samuel"),
    ("2SA", "2Sam", "2 Samuel"), ("1KI", "1Kgs", "1 Kings"), ("2KI", "2Kgs", "2 Kings"),
    ("1CH", "1Chr", "1 Chronicles"), ("2CH", "2Chr", "2 Chronicles"), ("EZR", "Ezra", "Ezra"),
    ("NEH", "Neh", "Nehemiah"), ("EST", "Esth", "Esther"), ("JOB", "Job", "Job"),
    ("PSA", "Ps", "Psalms"), ("PRO", "Prov", "Proverbs"), ("ECC", "Eccl", "Ecclesiastes"),
    ("SNG", "Song", "Song of Solomon"), ("ISA", "Isa", "Isaiah"), ("JER", "Jer", "Jeremiah"),
    ("LAM", "Lam", "Lamentations"), ("EZK", "Ezek", "Ezekiel"), ("DAN", "Dan", "Daniel"),
    ("HOS", "Hos", "Hosea"), ("JOL", "Joel", "Joel"), ("AMO", "Amos", "Amos"),
    ("OBA", "Obad", "Obadiah"), ("JON", "Jonah", "Jonah"), ("MIC", "Mic", "Micah"),
    ("NAM", "Nah", "Nahum"), ("HAB", "Hab", "Habakkuk"), ("ZEP", "Zeph", "Zephaniah"),
    ("HAG", "Hag", "Haggai"), ("ZEC", "Zech", "Zechariah"), ("MAL", "Mal", "Malachi"),
    ("MAT", "Matt", "Matthew"), ("MRK", "Mark", "Mark"), ("LUK", "Luke", "Luke"),
    ("JHN", "John", "John"), ("ACT", "Acts", "Acts"), ("ROM", "Rom", "Romans"),
    ("1CO", "1Cor", "1 Corinthians"), ("2CO", "2Cor", "2 Corinthians"), ("GAL", "Gal", "Galatians"),
    ("EPH", "Eph", "Ephesians"), ("PHP", "Phil", "Philippians"), ("COL", "Col", "Colossians"),
    ("1TH", "1Thess", "1 Thessalonians"), ("2TH", "2Thess", "2 Thessalonians"),
    ("1TI", "1Tim", "1 Timothy"), ("2TI", "2Tim", "2 Timothy"), ("TIT", "Titus", "Titus"),
    ("PHM", "Phlm", "Philemon"), ("HEB", "Heb", "Hebrews"), ("JAS", "Jas", "James"),
    ("1PE", "1Pet", "1 Peter"), ("2PE", "2Pet", "2 Peter"), ("1JN", "1John", "1 John"),
    ("2JN", "2John", "2 John"), ("3JN", "3John", "3 John"), ("JUD", "Jude", "Jude"),
    ("REV", "Rev", "Revelation"),
]

CANON: list[CanonBook] = [
    CanonBook(usfm=u, osis=o, order=i + 1, name_en=n) for i, (u, o, n) in enumerate(_CANON)
]

BY_USFM: dict[str, CanonBook] = {b.usfm: b for b in CANON}
BY_OSIS: dict[str, CanonBook] = {b.osis: b for b in CANON}


def is_canonical_usfm(code: str) -> bool:
    return code in BY_USFM


def normalize_osis_ref(value: str) -> str | None:
    """Normalize an OSIS ``osisRef`` to our canonical target, or None if unusable.

    Accepts ``Book.chapter.verse`` and single-chapter ranges (``Book.c.v-Book.c.v`` or
    ``Book.c.v-v``); returns ``Book.chapter.verse`` or ``Book.chapter.start-end``. The book must be
    canonical. Cross-chapter/cross-book ranges collapse to the starting verse (the pop-up shows the
    start rather than guessing an unbounded span).
    """
    value = (value or "").strip()
    if not value:
        return None
    start, _, end = value.partition("-")
    parts = start.split(".")
    if len(parts) != 3:
        return None
    book, chapter, verse = parts
    if book not in BY_OSIS or not (chapter.isdigit() and verse.isdigit()):
        return None
    ref = f"{book}.{int(chapter)}.{int(verse)}"
    if end:
        eparts = end.split(".")
        end_verse: str | None = None
        if len(eparts) == 3 and eparts[0] == book and eparts[1] == chapter and eparts[2].isdigit():
            end_verse = eparts[2]
        elif len(eparts) == 1 and eparts[0].isdigit():
            end_verse = eparts[0]
        if end_verse is not None and int(end_verse) > int(verse):
            ref += f"-{int(end_verse)}"
    return ref
