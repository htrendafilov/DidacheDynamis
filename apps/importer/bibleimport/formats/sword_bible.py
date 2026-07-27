"""Import a Bible exported as raw OSIS fragments by the official SWORD ``mod2imp`` tool.

Word-level lexical annotations (plan/search_workspace.md §10) are preserved, not discarded:
each ``<w lemma="strong:…" morph="…">`` becomes an unmerged CIR run carrying a ``lemma``
list, and contributes rows to ``verse_tokens``. A surface span can carry several Strong's
numbers ("created" -> H0853/H1254) and the morphology codes align positionally with them;
untranslated source words (empty ``<w/>``) yield token rows with an empty surface, and
translated-but-untagged spans (KJV ``transChange`` additions, punctuation, plain text)
yield a single NULL-id row each.
"""

from __future__ import annotations

import gzip
import re
from pathlib import Path

from defusedxml import ElementTree as DefusedET

from ..books import CANON
from ..canonical import (
    BookMeta,
    HeadingRow,
    Line,
    TokenRow,
    VerseRow,
    norm_ws,
    normalize_strong_id,
)

_KEY = re.compile(r"^(?P<book>(?:[1-3]\s*)?[A-Za-z ]+?)\s+(?P<chapter>\d+):(?P<verse>\d+)$")
_ALIASES = {re.sub(r"\s+", "", book.osis).casefold(): book.osis for book in CANON}
_ALIASES.update({re.sub(r"\s+", "", book.name_en).casefold(): book.osis for book in CANON})
_ALIASES["revelationofjohn"] = "Rev"

# A span is (surface text, lexical entries, words-of-Jesus). The lexical entries are the
# CIR `lemma` list: [{"id": "H7225", "s": "strongMorph", "m": "TH8804"}, ...]; empty for
# untagged spans. `s`/`m` are only present when the source tags morphology for that id.
_Span = tuple[str, list[dict], bool]


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


def _w_surface(element) -> str:
    """All text inside a <w> (divineName/transChange contribute text; notes/titles never do)."""
    parts: list[str] = []

    def walk(node) -> None:
        tag = node.tag.rsplit("}", 1)[-1]
        if tag in {"note", "title"}:
            return
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(element)
    return "".join(parts)


def _w_lexical(element) -> list[dict]:
    """Strong's ids + morphology of one <w>, normalized; [] when the span is untagged.

    Morphology codes align positionally with the ids (ordinal i takes morph token i; an
    id without a matching code — the OT untranslated-particle case — gets no morphology).
    Non-Strong's lemma tokens (lemma.TR Greek lemmas) are not identifiers and are skipped.
    """
    ids = []
    for token in element.attrib.get("lemma", "").split():
        if token.startswith("strong:"):
            normalized = normalize_strong_id(token[len("strong:") :])
            if normalized:
                ids.append(normalized)
    morphs = element.attrib.get("morph", "").split()
    entries = []
    for ordinal, strong_id in enumerate(ids):
        entry = {"id": strong_id}
        if ordinal < len(morphs):
            scheme, sep, code = morphs[ordinal].partition(":")
            if sep:
                entry["s"] = scheme
                entry["m"] = code
            else:
                entry["m"] = morphs[ordinal]
        entries.append(entry)
    return entries


def _collect_spans(spans: list[_Span], element, words_of_jesus: bool = False) -> None:
    tag = element.tag.rsplit("}", 1)[-1]
    if tag in {"note", "title"}:
        return
    if tag == "w":
        spans.append((_w_surface(element), _w_lexical(element), words_of_jesus))
        return  # the caller appends element.tail exactly once
    is_jesus = words_of_jesus or (tag == "q" and element.attrib.get("who") == "Jesus")
    if element.text:
        spans.append((element.text, [], is_jesus))
    for child in element:
        _collect_spans(spans, child, is_jesus)
        if child.tail:
            spans.append((child.tail, [], is_jesus))


def _token_rows(osis: str, chapter: int, verse: int, spans: list[_Span]) -> list[TokenRow]:
    """Merge adjacent untagged spans, then key every span (position, ordinal)."""
    merged: list[tuple[str, list[dict]]] = []
    for text, lemma, _wj in spans:
        if lemma:
            merged.append((text, lemma))
        elif merged and not merged[-1][1]:
            merged[-1] = (merged[-1][0] + text, [])
        else:
            merged.append((text, []))
    merged = [(surface, lemma) for surface, lemma in merged if surface or lemma]
    rows: list[TokenRow] = []
    for position, (surface, lemma) in enumerate(merged):
        normalized = norm_ws(surface).casefold()
        if not lemma:
            rows.append(
                TokenRow(osis, chapter, verse, position, 0, surface, normalized, None, None, None)
            )
            continue
        for ordinal, entry in enumerate(lemma):
            rows.append(
                TokenRow(
                    osis,
                    chapter,
                    verse,
                    position,
                    ordinal,
                    surface,
                    normalized,
                    entry["id"],
                    entry.get("s"),
                    entry.get("m"),
                )
            )
    return rows


def _parse_verse(fragment: str) -> tuple[dict, str, list[str], list[_Span]]:
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
    spans: list[_Span] = []
    if root.text:
        spans.append((root.text, [], False))
    for child in root:
        _collect_spans(spans, child)
        if child.tail:
            spans.append((child.tail, [], False))
    line = Line(kind="p", level=1, para_start=para_start)
    for text, lemma, is_jesus in spans:
        if lemma:
            line.add_lemma_text(text, is_jesus, lemma)
        else:
            line.add_text(text, is_jesus)
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
    cir = {"lines": [cir_line] if cir_line["runs"] else []}
    return cir, plain, [h for h in headings if h], spans


def load_sword_bible(
    path: str | Path,
) -> tuple[list[BookMeta], list[VerseRow], list[HeadingRow], list[TokenRow]]:
    path = Path(path)
    verses: list[VerseRow] = []
    headings: list[HeadingRow] = []
    tokens: list[TokenRow] = []
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
        cir, plain, verse_headings, spans = _parse_verse(fragment)
        verses.append(VerseRow(osis=osis, chapter=chapter, verse=verse, cir=cir, plain_text=plain))
        tokens.extend(_token_rows(osis, chapter, verse, spans))
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
    return books, verses, headings, tokens
