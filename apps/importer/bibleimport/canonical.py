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


# Commentary CIR (body_json): {"blocks": [{"kind": "heading"|"paragraph"|"quotation",
# "text": str, "runs": [{"t": str, "emphasis"?, "strong"?, "superscript"?, "ref"?}, ...]?}]}
COMMENTARY_BLOCK_KINDS = frozenset({"heading", "paragraph", "quotation"})


@dataclass(frozen=True)
class CommentaryDictionaryRef:
    """One internal dictionary target carried by a commentary run."""

    work_id: str
    entry_key: str
    headword: str

    def to_json(self) -> dict:
        return {
            "work_id": self.work_id,
            "entry_key": self.entry_key,
            "headword": self.headword,
        }

    @classmethod
    def from_json(cls, raw: dict) -> CommentaryDictionaryRef:
        if not isinstance(raw, dict):
            raise TypeError("commentary dictionary_ref must be an object")
        values: dict[str, str] = {}
        for key in ("work_id", "entry_key", "headword"):
            value = raw.get(key)
            if not isinstance(value, str) or not value:
                raise TypeError(f"commentary dictionary_ref.{key} must be a non-empty string")
            values[key] = value
        return cls(**values)


@dataclass(frozen=True)
class CommentaryRun:
    """One inline span inside a commentary block (emphasis, ref, verse-number superscript)."""

    t: str
    emphasis: bool = False
    strong: bool = False
    superscript: bool = False
    ref: str | None = None
    dictionary_ref: CommentaryDictionaryRef | None = None

    def to_json(self) -> dict:
        out: dict = {"t": self.t}
        if self.emphasis:
            out["emphasis"] = True
        if self.strong:
            out["strong"] = True
        if self.superscript:
            out["superscript"] = True
        if self.ref:
            out["ref"] = self.ref
        if self.dictionary_ref is not None:
            out["dictionary_ref"] = self.dictionary_ref.to_json()
        return out

    @classmethod
    def from_json(cls, raw: dict) -> CommentaryRun:
        if not isinstance(raw, dict) or "t" not in raw:
            raise TypeError("commentary run must be an object with 't'")
        text = raw["t"]
        if not isinstance(text, str):
            raise TypeError("commentary run t must be a string")
        flags: dict[str, bool] = {}
        for key in ("emphasis", "strong", "superscript"):
            value = raw.get(key, False)
            if not isinstance(value, bool):
                raise TypeError(f"commentary run {key} must be a boolean")
            flags[key] = value
        ref = raw.get("ref")
        if ref is not None:
            if not isinstance(ref, str):
                raise TypeError("commentary run ref must be a string")
            from .books import normalize_osis_ref

            if normalize_osis_ref(ref) != ref:
                raise ValueError(f"commentary run ref is not canonical: {ref!r}")
        dictionary_ref_raw = raw.get("dictionary_ref")
        if ref is not None and dictionary_ref_raw is not None:
            raise ValueError("commentary run cannot carry both ref and dictionary_ref")
        return cls(
            t=text,
            emphasis=flags["emphasis"],
            strong=flags["strong"],
            superscript=flags["superscript"],
            ref=ref,
            dictionary_ref=(
                CommentaryDictionaryRef.from_json(dictionary_ref_raw)
                if dictionary_ref_raw is not None
                else None
            ),
        )


@dataclass(frozen=True)
class CommentaryBlock:
    kind: str  # heading | paragraph | quotation
    text: str
    runs: tuple[CommentaryRun, ...] | None = None

    def to_json(self) -> dict:
        out: dict = {"kind": self.kind, "text": self.text}
        if self.runs is not None:
            out["runs"] = [run.to_json() for run in self.runs]
        return out

    @classmethod
    def from_json(cls, raw: dict, *, strict_runs: bool = False) -> CommentaryBlock:
        if not isinstance(raw, dict):
            raise TypeError("commentary block must be an object")
        kind = raw.get("kind")
        if kind not in COMMENTARY_BLOCK_KINDS:
            raise ValueError(f"invalid commentary block kind: {kind!r}")
        text = raw.get("text")
        if not isinstance(text, str):
            raise TypeError("commentary block text must be a string")
        runs_raw = raw.get("runs")
        runs: tuple[CommentaryRun, ...] | None = None
        if runs_raw is not None:
            if not isinstance(runs_raw, list):
                raise TypeError("commentary block runs must be a list")
            runs = tuple(CommentaryRun.from_json(item) for item in runs_raw)
            joined = "".join(run.t for run in runs)
            if strict_runs:
                if joined != text:
                    raise ValueError(
                        "commentary block text must equal concatenated run text exactly"
                    )
            elif norm_ws(joined) != norm_ws(text):
                raise ValueError("commentary block text must equal concatenated run text")
        return cls(kind=kind, text=text, runs=runs)


def commentary_body_from_json(raw: dict, *, strict_runs: bool = False) -> dict:
    """Validate a commentary body and return a normalised dict suitable for body_json.

    ``strict_runs=True`` (package import) requires exact text == concat(runs.t).
    Sword/ThML study imports use the looser whitespace-normalised check.
    """
    if not isinstance(raw, dict) or "blocks" not in raw:
        raise TypeError("commentary body must be an object with 'blocks'")
    blocks_raw = raw["blocks"]
    if not isinstance(blocks_raw, list) or not blocks_raw:
        raise TypeError("commentary body must have a non-empty blocks list")
    blocks = [CommentaryBlock.from_json(item, strict_runs=strict_runs) for item in blocks_raw]
    return {"blocks": [block.to_json() for block in blocks]}


def commentary_plain_text(body: dict) -> str:
    blocks = body.get("blocks") or []
    return "\n\n".join(str(block.get("text", "")) for block in blocks if block.get("text")).strip()


def make_commentary_unit_id(
    source_work: str,
    osis: str,
    chapter: int,
    verse_start: int | None,
    ordinal: int,
) -> str:
    """Stable unit identity (M2 §4.2). Ordinal is 1-based within the same key verse."""
    if verse_start is None:
        return f"{source_work}/{osis}/{chapter}/intro/{ordinal:02d}"
    return f"{source_work}/{osis}/{chapter}/{verse_start}-{verse_start}/{ordinal:02d}"


@dataclass
class CommentaryRow:
    osis: str
    chapter: int
    verse_start: int | None
    verse_end: int | None
    body: dict
    plain_text: str
    # Optional multi-work identity fields (filled by package import or source-unit synthesis).
    unit_id: str | None = None
    source_hash: str | None = None
    content_hash: str | None = None
    provenance_id: str | None = None


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
