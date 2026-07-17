"""USFX adapter — parses eBible.org USFX (USFM-as-XML) Bibles into the canonical model.

USFX is milestone-based: <c id="1"/>, <v id="1" bcv="GEN.1.1"/> and <ve/> are empty
markers, words are wrapped in <w>, poetry in <q>, red-letter in <wj>, Psalm titles in <d>.
We walk the document in order, tracking the current book/chapter/verse and block context.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

from defusedxml.ElementTree import fromstring

from ..books import BY_USFM, is_canonical_usfm
from ..canonical import BookMeta, HeadingRow, Line, VerseAccum, VerseRow, norm_ws

# Subtrees whose text must not enter verse content (notes, cross-refs, metadata, glossary).
SKIP = {
    "f", "fe", "x", "fig", "fr", "ft", "fq", "fqa", "fk", "fv", "fp", "fl",
    "xo", "xt", "xk", "xq", "wh", "rem", "ide", "cp", "cl", "toc", "sts",
    "ref", "k", "periph", "id",
}
PARA_TAGS = {"p", "m", "mi", "pi", "pc", "pmo", "pm", "pmc", "pmr", "ph", "pr", "cls", "nb"}
POETRY_TAGS = {"q", "qm", "qr", "qc", "qa", "qd"}
HEADING_TAGS = {"s", "ms", "mr", "sr", "sp", "d", "sd"}


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _first_int(s: str | None) -> int | None:
    if not s:
        return None
    m = re.search(r"\d+", s)
    return int(m.group()) if m else None


def _level_from(el) -> int:
    lv = el.get("level")
    if lv and lv.isdigit():
        return int(lv)
    m = re.search(r"(\d)\s*$", el.get("style") or "")
    return int(m.group(1)) if m else 1


class _BookBuilder:
    def __init__(self, osis: str, name: str, order: int):
        self.osis = osis
        self.name = name
        self.order = order
        self.chapter = 0
        self.max_chapter = 0
        self.cur: tuple[int, int] | None = None
        self.verses: dict[tuple[int, int], VerseAccum] = {}
        self.order_seen: list[tuple[int, int]] = []
        self.headings: list[HeadingRow] = []
        self._last_verse = 0
        self._kind = "p"
        self._level = 1
        self._para_start = True
        self._need_new_line = True
        self._wj = 0
        self._title_depth = 0
        self._title_kind = "section"
        self._title_buf: list[str] = []

    # --- milestones / blocks ---
    def set_chapter(self, cid: str | None) -> None:
        c = _first_int(cid)
        if c is not None:
            self.chapter = c
            self.max_chapter = max(self.max_chapter, c)
            self._last_verse = 0

    def start_verse(self, vid: str | None, bcv: str | None) -> None:
        ch, vs = self.chapter, None
        if bcv:
            parts = bcv.split(".")
            if len(parts) == 3:
                ch = _first_int(parts[1]) or ch
                vs = _first_int(parts[2])
        if vs is None:
            vs = _first_int(vid)
        if vs is None:
            return
        self.chapter = ch
        self.max_chapter = max(self.max_chapter, ch)
        key = (ch, vs)
        if key not in self.verses:
            self.verses[key] = VerseAccum()
            self.order_seen.append(key)
        self.cur = key
        self._last_verse = vs
        self._need_new_line = True

    def end_verse(self) -> None:
        self.cur = None

    def open_block(self, kind: str, level: int, para_start: bool) -> None:
        self._kind = kind
        self._level = level
        self._para_start = para_start
        self._need_new_line = True

    def _ensure_line(self) -> Line | None:
        if self.cur is None:
            return None
        acc = self.verses[self.cur]
        if self._need_new_line or not acc.lines:
            ln = Line(kind=self._kind, level=self._level, para_start=self._para_start)
            acc.lines.append(ln)
            self._need_new_line = False
            self._para_start = False  # only the first line of a paragraph flags a start
            return ln
        return acc.lines[-1]

    def add_text(self, text: str | None) -> None:
        if not text:
            return
        if self._title_depth > 0:
            self._title_buf.append(text)
            return
        ln = self._ensure_line()
        if ln is not None:
            ln.add_text(norm_ws(text), wj=self._wj > 0)

    # --- titles / section headings ---
    def begin_title(self, kind: str) -> None:
        self._title_depth += 1
        if self._title_depth == 1:
            self._title_kind = kind
            self._title_buf = []

    def end_title(self) -> None:
        self._title_depth -= 1
        if self._title_depth == 0:
            text = norm_ws("".join(self._title_buf)).strip()
            if text:
                self.headings.append(
                    HeadingRow(
                        osis=self.osis,
                        chapter=self.chapter,
                        before_verse=self._last_verse + 1,
                        kind=self._title_kind,
                        text=text,
                    )
                )

    # --- output ---
    def to_rows(self) -> tuple[BookMeta, list[VerseRow], list[HeadingRow]]:
        verses: list[VerseRow] = []
        for key in self.order_seen:
            acc = self.verses[key]
            cir = acc.cir()
            if not cir["lines"]:
                continue
            verses.append(
                VerseRow(osis=self.osis, chapter=key[0], verse=key[1],
                         cir=cir, plain_text=acc.plain_text())
            )
        meta = BookMeta(osis=self.osis, name=self.name, order=self.order,
                        chapter_count=self.max_chapter)
        return meta, verses, self.headings


def _walk(el, b: _BookBuilder) -> None:
    tag = _local(el.tag)
    if tag in SKIP:
        return
    opened_wj = started_title = False
    if tag == "c":
        b.set_chapter(el.get("id"))
    elif tag == "v":
        b.start_verse(el.get("id"), el.get("bcv"))
    elif tag == "ve":
        b.end_verse()
    elif tag in HEADING_TAGS:
        b.begin_title("title" if tag == "d" else "section")
        started_title = True
    elif tag in PARA_TAGS:
        b.open_block("p", 1, para_start=(tag != "nb"))
    elif tag in POETRY_TAGS:
        b.open_block("q", _level_from(el), para_start=False)
    elif tag == "wj":
        b._wj += 1
        opened_wj = True

    b.add_text(el.text)
    for child in el:
        _walk(child, b)
        b.add_text(child.tail)

    if opened_wj:
        b._wj -= 1
    if started_title:
        b.end_title()


def _book_name(book_el, fallback: str) -> str:
    for child in book_el:
        if _local(child.tag) == "h" and (child.text or "").strip():
            return norm_ws(child.text).strip()
    return fallback


def parse_root(root) -> tuple[list[BookMeta], list[VerseRow], list[HeadingRow]]:
    books: list[BookMeta] = []
    verses: list[VerseRow] = []
    headings: list[HeadingRow] = []
    for book_el in root:
        if _local(book_el.tag) != "book":
            continue
        code = book_el.get("id")
        if not code or not is_canonical_usfm(code):
            continue
        canon = BY_USFM[code]
        builder = _BookBuilder(osis=canon.osis, name=_book_name(book_el, canon.name_en),
                               order=canon.order)
        _walk(book_el, builder)
        bmeta, bverses, bheadings = builder.to_rows()
        books.append(bmeta)
        verses.extend(bverses)
        headings.extend(bheadings)
    books.sort(key=lambda b: b.order)
    return books, verses, headings


def load_usfx(source: str | Path) -> tuple[list[BookMeta], list[VerseRow], list[HeadingRow]]:
    """Accepts a .zip (finds *_usfx.xml inside) or a path to the USFX .xml file."""
    source = Path(source)
    if source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith(".xml") and "usfx" in n.lower()]
            if not names:
                raise ValueError(f"no *usfx*.xml found in {source}")
            data = zf.read(names[0])
    else:
        data = source.read_bytes()
    root = fromstring(data.decode("utf-8") if isinstance(data, bytes) else data)
    return parse_root(root)


# Kept for symmetry with a future BytesIO caller.
def load_usfx_bytes(data: bytes) -> tuple[list[BookMeta], list[VerseRow], list[HeadingRow]]:
    return parse_root(fromstring(io.BytesIO(data).read().decode("utf-8")))
