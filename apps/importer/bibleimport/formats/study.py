"""Safe parsers for the M3 public-domain study works.

CCEL publishes Matthew Henry and Easton's in ThML.  The files declare an
external DTD, but the content does not need it: we remove the declaration and
parse with DTD/entities/external access forbidden.  Raw ThML never leaves the
importer; the API receives only the small document CIR produced here.
"""

from __future__ import annotations

import csv
import gzip
import re
from collections import Counter
from pathlib import Path

from defusedxml import ElementTree as DefusedET

from ..books import BY_OSIS, CANON, normalize_osis_ref
from ..canonical import CommentaryRow, DictionaryRow, XrefRow, norm_ws

_MAX_XML_BYTES = 64 * 1024 * 1024
_MAX_TSV_BYTES = 32 * 1024 * 1024
_DOCTYPE = re.compile(rb"<!DOCTYPE\s+[^>]*>", re.IGNORECASE | re.DOTALL)
_COMMENTARY_REF = re.compile(
    r"^Bible:(?P<book>[1-3]?[A-Za-z]+)\.(?P<chapter>\d+)"
    r"(?:\.(?P<start>\d+))?(?:-[1-3]?[A-Za-z]+\.\d+\.(?P<end>\d+))?$"
)
_TARGET_REF = re.compile(r"^(?P<book>(?:[1-3]\s*)?[A-Za-z]+)\s+(?P<chapter>\d+):(?P<verses>.+)$")
_IMP_COMMENTARY_KEY = re.compile(
    r"^(?P<book>(?:[1-3]\s*)?[A-Za-z ]+?)\s+(?P<chapter>\d+):(?P<verse>\d+)$"
)


def _read_limited(path: Path, limit: int) -> bytes:
    size = path.stat().st_size
    if size > limit:
        raise ValueError(f"source exceeds {limit // (1024 * 1024)} MiB limit: {path}")
    return path.read_bytes()


def _load_thml(path: str | Path):
    path = Path(path)
    raw = _read_limited(path, _MAX_XML_BYTES)
    if b"<!ENTITY" in raw.upper():
        raise ValueError(f"XML entity declarations are not allowed: {path}")
    # CCEL's PUBLIC DTD is metadata only. Remove it, then make the parser reject
    # any remaining DTD/entity/external declaration.
    clean = _DOCTYPE.sub(b"", raw, count=1)
    return DefusedET.fromstring(
        clean,
        forbid_dtd=True,
        forbid_entities=True,
        forbid_external=True,
    )


def _text(element) -> str:
    return norm_ws("".join(element.itertext())).strip()


def _document(element, *, skip_passage: bool = False) -> tuple[dict, str]:
    blocks: list[dict[str, str]] = []
    for child in element.iter():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag not in {"h1", "h2", "h3", "h4", "p", "blockquote"}:
            continue
        if skip_passage and tag == "p" and child.attrib.get("class") == "passage":
            continue
        text = _text(child)
        if not text:
            continue
        kind = "heading" if tag.startswith("h") else "paragraph"
        blocks.append({"kind": kind, "text": text})
    plain = "\n\n".join(block["text"] for block in blocks)
    return {"blocks": blocks}, plain


def _imp_entries(path: str | Path):
    """Yield SWORD IMP entries from plain or gzip output without loading it all."""
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    key: str | None = None
    lines: list[str] = []
    total = 0
    with opener(path, "rt", encoding="utf-8", errors="strict") as handle:
        for line in handle:
            total += len(line.encode("utf-8"))
            if total > 256 * 1024 * 1024:
                raise ValueError(f"expanded IMP exceeds 256 MiB limit: {path}")
            if line.startswith("$$$"):
                if key is not None:
                    yield key, "".join(lines).strip()
                key = line[3:].strip()
                lines = []
            elif key is not None:
                lines.append(line)
    if key is not None:
        yield key, "".join(lines).strip()


def _plain_document(text: str, *, skip_first_line: bool = False) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if skip_first_line:
        _, _, text = text.partition("\n")
    paragraphs = [norm_ws(part).strip() for part in re.split(r"\n\s*\n", text)]
    paragraphs = [part for part in paragraphs if part]
    blocks = [{"kind": "paragraph", "text": part} for part in paragraphs]
    return {"blocks": blocks}, "\n\n".join(paragraphs)


def _append_document_run(
    runs: list[dict],
    text: str | None,
    *,
    emphasis: bool = False,
    strong: bool = False,
    superscript: bool = False,
    ref: str | None = None,
) -> None:
    if not text:
        return
    flags = {
        "emphasis": emphasis,
        "strong": strong,
        "superscript": superscript,
    }
    if (
        runs
        and runs[-1].get("ref") == ref
        and all(runs[-1].get(key, False) == value for key, value in flags.items())
    ):
        runs[-1]["t"] += text
        return
    run: dict[str, str | bool] = {"t": text}
    run.update({key: value for key, value in flags.items() if value})
    if ref:
        run["ref"] = ref
    runs.append(run)


def _collect_document_runs(
    runs: list[dict],
    element,
    *,
    emphasis: bool = False,
    strong: bool = False,
    superscript: bool = False,
) -> None:
    tag = element.tag.rsplit("}", 1)[-1]
    if tag == "reference":
        ref = normalize_osis_ref(element.attrib.get("osisRef", ""))
        if ref:
            text = "".join(element.itertext())
            if text.strip():
                _append_document_run(
                    runs,
                    text,
                    emphasis=emphasis,
                    strong=strong,
                    superscript=superscript,
                    ref=ref,
                )
                return
    hi_type = element.attrib.get("type", "") if tag == "hi" else ""
    own_emphasis = emphasis or hi_type == "italic"
    own_strong = strong or hi_type == "bold"
    own_superscript = superscript or hi_type == "super"
    _append_document_run(
        runs,
        element.text,
        emphasis=own_emphasis,
        strong=own_strong,
        superscript=own_superscript,
    )
    for child in element:
        _collect_document_runs(
            runs,
            child,
            emphasis=own_emphasis,
            strong=own_strong,
            superscript=own_superscript,
        )
        _append_document_run(
            runs,
            child.tail,
            emphasis=own_emphasis,
            strong=own_strong,
            superscript=own_superscript,
        )


def _finish_document_runs(runs: list[dict]) -> tuple[list[dict], str]:
    if not runs:
        return [], ""
    runs[0]["t"] = runs[0]["t"].lstrip()
    runs[-1]["t"] = runs[-1]["t"].rstrip()
    runs = [run for run in runs if run["t"]]
    text = norm_ws("".join(str(run["t"]) for run in runs)).strip()
    return runs, text


def _sword_osis_document(text: str) -> tuple[dict, str]:
    """Convert raw OSIS markup from ``mod2imp`` to the study-document CIR."""
    try:
        root = DefusedET.fromstring(
            f"<root>{text}</root>",
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
    except Exception as exc:
        raise ValueError("invalid OSIS fragment in SWORD commentary export") from exc

    blocks: list[dict] = []
    current: list[dict] | None = None

    def flush() -> None:
        nonlocal current
        if current is None:
            return
        runs, plain = _finish_document_runs(current)
        if plain:
            kind = "quotation" if any(run.get("superscript") for run in runs) else "paragraph"
            blocks.append({"kind": kind, "text": plain, "runs": runs})
        current = None

    for child in root:
        tag = child.tag.rsplit("}", 1)[-1]
        is_paragraph = tag == "div" and child.attrib.get("type") == "x-p"
        if tag == "title":
            flush()
            title = _text(child)
            if title:
                blocks.append({"kind": "heading", "text": title})
            continue
        if is_paragraph and "sID" in child.attrib:
            flush()
            current = []
            _append_document_run(current, child.tail)
            continue
        if is_paragraph and "eID" in child.attrib:
            flush()
            continue
        if current is not None:
            _collect_document_runs(current, child)
            _append_document_run(current, child.tail)
    flush()
    plain = "\n\n".join(block["text"] for block in blocks)
    return {"blocks": blocks}, plain


def load_commentary(paths: list[str | Path]) -> list[CommentaryRow]:
    """Load CCEL Matthew Henry ThML volumes into reference-bound entries."""
    rows: list[CommentaryRow] = []
    for path in paths:
        root = _load_thml(path)
        for div in root.iter("div"):
            if div.attrib.get("class") != "Commentary":
                continue
            match = _COMMENTARY_REF.match(div.attrib.get("id", ""))
            if not match:
                continue
            osis = match.group("book")
            if osis not in BY_OSIS:
                continue
            body, plain = _document(div, skip_passage=True)
            if not body["blocks"]:
                continue
            start = int(match.group("start")) if match.group("start") else None
            end = int(match.group("end")) if match.group("end") else start
            rows.append(
                CommentaryRow(
                    osis=osis,
                    chapter=int(match.group("chapter")),
                    verse_start=start,
                    verse_end=end,
                    body=body,
                    plain_text=plain,
                )
            )
    return rows


def load_sword_commentary(paths: list[str | Path]) -> list[CommentaryRow]:
    """Load raw OSIS or legacy stripped IMP produced by official SWORD tools."""
    rows: list[CommentaryRow] = []
    for path in paths:
        for key, text in _imp_entries(path):
            match = _IMP_COMMENTARY_KEY.match(key)
            if not match:
                continue
            osis = _osis_book(match.group("book"))
            chapter = int(match.group("chapter"))
            verse = int(match.group("verse"))
            if osis is None or chapter < 1 or verse < 1 or not text:
                continue
            body, plain = (
                _sword_osis_document(text)
                if text.lstrip().startswith("<")
                else _plain_document(text)
            )
            if body["blocks"]:
                rows.append(
                    CommentaryRow(
                        osis=osis,
                        chapter=chapter,
                        verse_start=verse,
                        verse_end=verse,
                        body=body,
                        plain_text=plain,
                    )
                )
    return rows


def load_dictionary(path: str | Path, language: str = "en") -> list[DictionaryRow]:
    """Load alternating ThML glossary term/definition pairs."""
    root = _load_thml(path)
    rows: list[DictionaryRow] = []
    for glossary in root.iter("glossary"):
        children = list(glossary)
        for index, child in enumerate(children[:-1]):
            if child.tag.rsplit("}", 1)[-1] != "term":
                continue
            definition = children[index + 1]
            if definition.tag.rsplit("}", 1)[-1] != "def":
                continue
            headword = _text(child)
            body, plain = _document(definition)
            if headword and body["blocks"]:
                rows.append(
                    DictionaryRow(
                        headword=headword,
                        sort_key=headword.casefold(),
                        language=language,
                        body=body,
                        plain_text=plain,
                    )
                )
    return rows


def load_sword_dictionary(path: str | Path, language: str = "en") -> list[DictionaryRow]:
    """Load plain IMP produced by the official ``mod2imp Easton -s`` utility."""
    rows: list[DictionaryRow] = []
    for key, text in _imp_entries(path):
        if not text:
            continue
        first_line = next((line.strip() for line in text.splitlines() if line.strip()), key)
        headword = first_line.split(".  ", 1)[0].strip() or key.strip()
        body, plain = _plain_document(text, skip_first_line=True)
        if headword and body["blocks"]:
            rows.append(
                DictionaryRow(
                    headword=headword,
                    sort_key=headword.casefold(),
                    language=language,
                    body=body,
                    plain_text=plain,
                )
            )
    return rows


_BOOK_ALIASES = {re.sub(r"\s+", "", book.osis).casefold(): book.osis for book in CANON}
_BOOK_ALIASES.update(
    {re.sub(r"\s+", "", book.name_en).casefold(): book.osis for book in CANON}
)


def _osis_book(value: str) -> str | None:
    return _BOOK_ALIASES.get(re.sub(r"\s+", "", value).casefold())


def _normalize_target(value: str) -> str | None:
    match = _TARGET_REF.match(value.strip())
    if not match:
        return None
    osis = _osis_book(match.group("book"))
    if osis is None:
        return None
    verses = re.sub(r"\s+", "", match.group("verses"))
    # A ":" here means a cross-chapter range (e.g. "1-2:3"); keep only the starting
    # verse in this chapter so the target is always a well-formed osis.chapter.verse(-range).
    if ":" in verses:
        start = re.match(r"\d+", verses)
        if not start:
            return None
        verses = start.group(0)
    return f"{osis}.{int(match.group('chapter'))}.{verses}"


def load_xrefs(path: str | Path) -> list[XrefRow]:
    """Load phrase-level TSK-derived TSV and aggregate duplicate source/targets."""
    path = Path(path)
    if path.stat().st_size > _MAX_TSV_BYTES:
        raise ValueError(f"source exceeds {_MAX_TSV_BYTES // (1024 * 1024)} MiB limit: {path}")
    counts: Counter[tuple[str, int, int, str]] = Counter()
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        required = {"book", "chapter", "verse", "references"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("cross-reference TSV is missing required columns")
        for source in reader:
            osis = _osis_book(source["book"])
            if osis is None:
                continue
            try:
                chapter = int(source["chapter"])
                verse = int(source["verse"])
            except ValueError:
                continue
            if chapter < 1 or verse < 1:
                continue
            for raw_target in source["references"].split("|"):
                target = _normalize_target(raw_target)
                if target:
                    counts[(osis, chapter, verse, target)] += 1
    return [XrefRow(*key, votes=votes) for key, votes in sorted(counts.items())]
