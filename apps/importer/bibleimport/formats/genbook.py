"""Adapter for hierarchical SWORD General Book exports (``mod2imp`` IMP files).

SWORD GenBook keys are slash-delimited paths. The adapter materializes missing parent nodes and
converts the entry markup to the same small Document CIR used by commentary and dictionaries.
The source module used by M6 contains a few legacy, mismatched OSIS tags, so a strict allow-listed
HTML tokenizer is used instead of accepting or forwarding raw markup.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

from ..canonical import BookSectionRow, norm_ws
from .study import _imp_entries

_KNOWN_TAGS = {
    "hi",
    "item",
    "list",
    "note",
    "p",
    "reference",
    "title",
    "titlepage",
}
_BLOCK_TAGS = {"p", "item", "title"}
_CHAPTER = re.compile(r"^chapter\s+\d+$", re.IGNORECASE)
_NON_ID = re.compile(r"[^\w]+", re.UNICODE)
_SMALL_TITLE_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "the", "to"}


class _DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict] = []
        self._kind: str | None = None
        self._runs: list[dict] = []
        self._note_depth = 0
        self._emphasis_depth = 0
        self._strong_depth = 0
        self._superscript_depth = 0

    def _flush(self) -> None:
        if self._kind is None:
            return
        if self._runs:
            self._runs[0]["t"] = str(self._runs[0]["t"]).lstrip()
            self._runs[-1]["t"] = str(self._runs[-1]["t"]).rstrip()
        runs = [run for run in self._runs if run["t"]]
        plain = norm_ws("".join(str(run["t"]) for run in runs)).strip()
        if plain:
            self.blocks.append({"kind": self._kind, "text": plain, "runs": runs})
        self._kind = None
        self._runs = []

    def _start_block(self, kind: str, prefix: str = "") -> None:
        self._flush()
        self._kind = kind
        if prefix:
            self.handle_data(prefix)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.casefold()
        if tag not in _KNOWN_TAGS:
            raise ValueError(f"unsupported General Book markup: <{tag}>")
        values = dict(attrs)
        if tag in _BLOCK_TAGS:
            kind = "heading" if tag == "title" else "paragraph"
            self._start_block(kind, "• " if tag == "item" else "")
        elif tag == "note":
            self._note_depth += 1
        elif tag == "hi":
            hi_type = (values.get("type") or "").casefold()
            if hi_type not in {"", "bold", "italic", "super"}:
                raise ValueError(f"unsupported General Book highlight type: {hi_type}")
            self._emphasis_depth += int(hi_type == "italic")
            self._strong_depth += int(hi_type == "bold")
            self._superscript_depth += int(hi_type == "super")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.casefold()
        if tag not in _KNOWN_TAGS:
            raise ValueError(f"unsupported General Book markup: </{tag}>")
        if tag in _BLOCK_TAGS:
            self._flush()
        elif tag == "note":
            self._note_depth = max(0, self._note_depth - 1)
        elif tag == "hi":
            # The production source currently has no hi tags. Reset all optional styles so a
            # malformed legacy closing tag cannot leak formatting into later blocks.
            self._emphasis_depth = 0
            self._strong_depth = 0
            self._superscript_depth = 0

    def handle_data(self, data: str) -> None:
        data = data.replace("\\.", ".")
        if not data or (self._kind is None and not data.strip()):
            return
        if self._kind is None:
            self._kind = "paragraph"
        flags = {
            "emphasis": self._emphasis_depth > 0,
            "strong": self._strong_depth > 0,
            "superscript": self._superscript_depth > 0 or self._note_depth > 0,
        }
        if self._runs and all(self._runs[-1].get(key, False) == value for key, value in flags.items()):
            self._runs[-1]["t"] += data
            return
        run: dict[str, str | bool] = {"t": data}
        run.update({key: value for key, value in flags.items() if value})
        self._runs.append(run)

    def handle_decl(self, decl: str) -> None:
        raise ValueError("declarations are not allowed in General Book markup")

    def finish(self) -> tuple[dict, str]:
        self._flush()
        plain = "\n\n".join(block["text"] for block in self.blocks)
        return {"blocks": self.blocks}, plain


def _document(fragment: str) -> tuple[dict, str]:
    parser = _DocumentParser()
    try:
        parser.feed(fragment)
        parser.close()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("invalid markup in SWORD General Book export") from exc
    return parser.finish()


def _section_slug(value: str) -> str:
    slug = _NON_ID.sub("-", value.casefold()).strip("-")
    if not slug:
        raise ValueError(f"General Book key has no usable section name: {value!r}")
    return slug


def _display_title(leaf: str, body: dict) -> str:
    headings = [block["text"] for block in body["blocks"] if block["kind"] == "heading"]
    if leaf.casefold() == "content":
        return "Contents"
    if (_CHAPTER.match(leaf) and len(headings) >= 2) or leaf.casefold() == "end":
        subject = headings[1] if _CHAPTER.match(leaf) else headings[0]
        if subject.isupper():
            words = subject.casefold().split()
            subject = " ".join(
                word if index and word in _SMALL_TITLE_WORDS else word[:1].upper() + word[1:]
                for index, word in enumerate(words)
            )
        return f"{leaf} — {subject}" if _CHAPTER.match(leaf) else subject
    return leaf


def load_genbook(path: str | Path) -> list[BookSectionRow]:
    """Load slash-keyed IMP entries and return a deterministic parent-before-child section list."""
    rows: dict[tuple[str, ...], BookSectionRow] = {}
    ids: dict[str, tuple[str, ...]] = {}
    order = 0
    for raw_key, fragment in _imp_entries(path):
        parts = tuple(norm_ws(part).strip() for part in raw_key.split("/") if part.strip())
        if not parts or not fragment.strip():
            continue
        for index in range(len(parts)):
            section_path = parts[: index + 1]
            section_id = ".".join(_section_slug(part) for part in section_path)
            previous_path = ids.get(section_id)
            if previous_path is not None and previous_path != section_path:
                raise ValueError(f"General Book section id collision: {section_id}")
            ids[section_id] = section_path
            is_entry = index == len(parts) - 1
            body, plain = _document(fragment) if is_entry else ({"blocks": []}, "")
            existing = rows.get(section_path)
            if existing is not None:
                if is_entry:
                    existing.body = body
                    existing.plain_text = plain
                    existing.title = _display_title(parts[-1], body)
                continue
            parent_id = (
                ".".join(_section_slug(part) for part in section_path[:-1])
                if len(section_path) > 1
                else None
            )
            rows[section_path] = BookSectionRow(
                section_id=section_id,
                parent_id=parent_id,
                sort_order=order,
                level=len(section_path),
                title=_display_title(parts[-1], body),
                body=body,
                plain_text=plain,
            )
            order += 1
    return list(rows.values())
