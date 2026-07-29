"""Canonical Intermediate Representation (CIR) types and the parsed-work container.

Per-verse CIR (stored as verses.nodes_json):

    {"lines": [
        {"kind": "p"|"q", "level": int, "para_start": bool,
         "runs": [{"wj": bool, "t": str}, ...]}
    ]}

- kind "p" = prose paragraph; "q" = poetry line (level = indent depth).
- para_start marks the verse whose content begins a new paragraph (lets the reader join
  verses in "flowing" mode and break them in "per-line" mode).
- runs are contiguous text spans; wj=True marks words of Jesus (red-letter).

Only the node kinds WEB actually produces are modelled here. Additional inline kinds
(divineName, emphasis, note, xref) are added when a source that carries them is imported.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

_WS = re.compile(r"\s+")
_STRONG_ID = re.compile(r"^(?P<letter>[HGhg])(?P<number>\d+)(?P<suffix>[A-Za-z]?)$")


def norm_ws(text: str) -> str:
    return _WS.sub(" ", text)


def normalize_strong_id(value: str) -> str | None:
    """Canonical Strong's identifier: letter + zero-padded 4-digit number + optional
    uppercase suffix ('H07225' -> 'H7225', 'G26' -> 'G0026', 'G0031a' -> 'G0031A').

    Both testaments fit four digits (Hebrew runs to H8674, Greek to G5624), so this
    collapses the KJV's inconsistent OT/NT padding onto the same form the lexicon
    keys normalize to. Returns None for anything that is not a Strong's id.
    """
    match = _STRONG_ID.match(value.strip())
    if not match:
        return None
    letter = match.group("letter").upper()
    number = int(match.group("number"))
    suffix = match.group("suffix").upper()
    return f"{letter}{number:04d}{suffix}"


def normalize_lexical_search(value: str) -> str:
    """Case/diacritic-fold text for M8.4 structured lexicon search.

    Greek accents and Hebrew niqqud are combining marks after NFKD decomposition.
    Removing them and case-folding gives the API deterministic searchable shadow
    values without parsing or normalizing source content at runtime.

    `apps/api/app/strongs.py` holds the query-side twin of this fold; the API never imports
    the importer (see AGENTS.md). The two must stay byte-identical in behaviour.
    """
    decomposed = unicodedata.normalize("NFKD", value)
    folded = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return norm_ws(folded.casefold()).strip()


@dataclass
class Line:
    kind: str  # 'p' | 'q'
    level: int
    para_start: bool
    runs: list[dict] = field(default_factory=list)

    def add_text(self, text: str, wj: bool) -> None:
        if not text:
            return
        if self.runs and self.runs[-1]["wj"] == wj and "lemma" not in self.runs[-1]:
            self.runs[-1]["t"] += text
        else:
            self.runs.append({"wj": wj, "t": text})

    def add_lemma_text(self, text: str, wj: bool, lemma: list[dict]) -> None:
        """A lexical span (OSIS ``<w lemma="strong:…">``): never merged with neighbours,
        so the reader can anchor a popover to exactly this surface word."""
        if not text:
            return
        self.runs.append({"wj": wj, "t": text, "lemma": lemma})

    def to_json(self) -> dict:
        runs = []
        for r in self.runs:
            t = r["t"]
            if t:
                run = {"t": t}
                if r["wj"]:
                    run = {"wj": True, **run}
                if "lemma" in r:
                    run["lemma"] = r["lemma"]
                runs.append(run)
        return {"kind": self.kind, "level": self.level, "para_start": self.para_start, "runs": runs}


@dataclass
class VerseAccum:
    lines: list[Line] = field(default_factory=list)

    def cir(self) -> dict:
        out = []
        for ln in self.lines:
            j = ln.to_json()
            # collapse leading/trailing whitespace on the line's edge runs
            if j["runs"]:
                j["runs"][0]["t"] = j["runs"][0]["t"].lstrip()
                j["runs"][-1]["t"] = j["runs"][-1]["t"].rstrip()
                j["runs"] = [r for r in j["runs"] if r["t"]]
            if j["runs"]:
                out.append(j)
        return {"lines": out}

    def plain_text(self) -> str:
        parts = []
        for ln in self.lines:
            for r in ln.runs:
                parts.append(r["t"])
            parts.append(" ")
        return norm_ws("".join(parts)).strip()


@dataclass
class TokenRow:
    """One surface span of a verse (plan/search_workspace.md §10.3).

    `position` is the 0-based span index in document order; `ordinal` disambiguates the
    multiple Strong's numbers one span can carry ('created' -> H0853/H1254). An untagged
    span (plain text, punctuation, KJV transChange additions) gets exactly one row with
    ordinal=0 and strong_id NULL, so every surface span appears in verse_tokens.
    """

    osis: str
    chapter: int
    verse: int
    position: int
    ordinal: int
    surface: str
    normalized: str
    strong_id: str | None
    morph_scheme: str | None
    morph_code: str | None


@dataclass
class LexiconRow:
    strong_id: str
    language: str  # 'grc' | 'hbo'
    lemma: str
    transliteration: str | None
    pronunciation: str | None
    definition: dict  # -> strong_lexicon.definition_json
    plain_text: str


@dataclass
class BookMeta:
    osis: str
    name: str
    order: int
    chapter_count: int


@dataclass
class VerseRow:
    osis: str
    chapter: int
    verse: int
    cir: dict
    plain_text: str


@dataclass
class HeadingRow:
    osis: str
    chapter: int
    before_verse: int
    kind: str  # 'section' | 'title'
    text: str


@dataclass
class CommentaryRow:
    osis: str
    chapter: int
    verse_start: int | None
    verse_end: int | None
    body: dict
    plain_text: str


@dataclass
class DictionaryRow:
    headword: str
    sort_key: str
    language: str
    body: dict
    plain_text: str


@dataclass
class BookSectionRow:
    section_id: str
    parent_id: str | None
    sort_order: int
    level: int
    title: str
    body: dict
    plain_text: str


@dataclass(frozen=True)
class XrefRow:
    osis: str
    chapter: int
    verse: int
    target_ref: str
    votes: int = 1


@dataclass
class WorkMeta:
    id: str
    type: str
    language: str
    title: str
    abbrev: str
    direction: str
    versification: str
    license: str
    attribution: str
    source_url: str | None
    source_version: str | None
    ai_context_policy: str  # 'allowed' | 'allowed_no_training' | 'prohibited' | 'unknown'
    checksum: str


@dataclass
class ParsedWork:
    meta: WorkMeta
    books: list[BookMeta]
    verses: list[VerseRow]
    headings: list[HeadingRow]
