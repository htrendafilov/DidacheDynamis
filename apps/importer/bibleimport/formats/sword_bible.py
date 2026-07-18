"""Import a Bible exported as raw OSIS fragments by the official SWORD ``mod2imp`` tool."""

from __future__ import annotations

import gzip
import re
from pathlib import Path

from defusedxml import ElementTree as DefusedET

from ..books import CANON
from ..canonical import BookMeta, HeadingRow, Line, VerseRow, norm_ws

_KEY = re.compile(r"^(?P<book>(?:[1-3]\s*)?[A-Za-z ]+?)\s+(?P<chapter>\d+):(?P<verse>\d+)$")
_ALIASES = {re.sub(r"\s+", "", book.osis).casefold(): book.osis for book in CANON}
_ALIASES.update({re.sub(r"\s+", "", book.name_en).casefold(): book.osis for book in CANON})
_ALIASES["revelationofjohn"] = "Rev"


def _entries(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    key: str | None = None
    lines: list[str] = []
    total = 0
    with opener(path, "rt", encoding="utf-8", errors="strict") as handle:
        for source_line in handle:
            total += len(source_line.encode("utf-8"))
            if total > 128 * 1024 * 1024:
                raise ValueError(f"expanded SWORD Bible IMP exceeds 128 MiB: {path}")
            if source_line.startswith("$$$"):
                if key is not None:
                    yield key, "".join(lines).strip()
                key = source_line[3:].strip()
                lines = []
            elif key is not None:
                lines.append(source_line)
    if key is not None:
        yield key, "".join(lines).strip()


def _osis_book(value: str) -> str | None:
    value = value.strip()
    roman_match = re.match(r"^(III|II|I)\s+(.+)$", value, re.IGNORECASE)
    if roman_match:
        number = {"i": "1", "ii": "2", "iii": "3"}[roman_match.group(1).casefold()]
        value = number + roman_match.group(2)
    normalized = re.sub(r"\s+", "", value).casefold()
    return _ALIASES.get(normalized)


def _append_text(line: Line, text: str | None, words_of_jesus: bool) -> None:
    if text:
        line.add_text(text, words_of_jesus)


def _collect_text(line: Line, element, words_of_jesus: bool = False) -> None:
    tag = element.tag.rsplit("}", 1)[-1]
    if tag in {"note", "title"}:
        return
    is_jesus = words_of_jesus or (tag == "q" and element.attrib.get("who") == "Jesus")
    _append_text(line, element.text, is_jesus)
    for child in element:
        _collect_text(line, child, is_jesus)
        _append_text(line, child.tail, is_jesus)


def _parse_verse(fragment: str) -> tuple[dict, str, list[str]]:
    try:
        root = DefusedET.fromstring(
            f"<root>{fragment}</root>",
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
    except Exception as exc:
        raise ValueError("invalid OSIS fragment in SWORD Bible export") from exc

    para_start = any(
        element.tag.rsplit("}", 1)[-1] in {"p", "milestone"}
        and (element.tag.rsplit("}", 1)[-1] == "p" or element.attrib.get("type") == "x-p")
        for element in root.iter()
    )
    line = Line(kind="p", level=1, para_start=para_start)
    _append_text(line, root.text, False)
    for child in root:
        _collect_text(line, child)
        _append_text(line, child.tail, False)
    cir_line = line.to_json()
    if cir_line["runs"]:
        cir_line["runs"][0]["t"] = cir_line["runs"][0]["t"].lstrip()
        cir_line["runs"][-1]["t"] = cir_line["runs"][-1]["t"].rstrip()
        cir_line["runs"] = [run for run in cir_line["runs"] if run["t"]]
    plain = norm_ws("".join(run["t"] for run in cir_line["runs"])).strip()
    headings = [
        norm_ws("".join(title.itertext())).strip()
        for title in root.iter()
        if title.tag.rsplit("}", 1)[-1] == "title"
        and title.attrib.get("type") not in {"chapter", "main"}
    ]
    return {"lines": [cir_line] if cir_line["runs"] else []}, plain, [h for h in headings if h]


def load_sword_bible(path: str | Path) -> tuple[list[BookMeta], list[VerseRow], list[HeadingRow]]:
    path = Path(path)
    verses: list[VerseRow] = []
    headings: list[HeadingRow] = []
    chapter_counts: dict[str, int] = {}
    for key, fragment in _entries(path):
        match = _KEY.match(key)
        if not match:
            continue
        osis = _osis_book(match.group("book"))
        chapter = int(match.group("chapter"))
        verse = int(match.group("verse"))
        if osis is None or chapter < 1 or verse < 1 or not fragment:
            continue
        cir, plain, verse_headings = _parse_verse(fragment)
        verses.append(VerseRow(osis=osis, chapter=chapter, verse=verse, cir=cir, plain_text=plain))
        headings.extend(
            HeadingRow(
                osis=osis,
                chapter=chapter,
                before_verse=verse,
                kind="section",
                text=heading,
            )
            for heading in verse_headings
        )
        chapter_counts[osis] = max(chapter_counts.get(osis, 0), chapter)
    books = [
        BookMeta(
            osis=book.osis,
            name=book.name_en,
            order=book.order,
            chapter_count=chapter_counts[book.osis],
        )
        for book in CANON
        if book.osis in chapter_counts
    ]
    return books, verses, headings
