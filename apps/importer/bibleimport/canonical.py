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
from dataclasses import dataclass, field

_WS = re.compile(r"\s+")


def norm_ws(text: str) -> str:
    return _WS.sub(" ", text)


@dataclass
class Line:
    kind: str  # 'p' | 'q'
    level: int
    para_start: bool
    runs: list[dict] = field(default_factory=list)

    def add_text(self, text: str, wj: bool) -> None:
        if not text:
            return
        if self.runs and self.runs[-1]["wj"] == wj:
            self.runs[-1]["t"] += text
        else:
            self.runs.append({"wj": wj, "t": text})

    def to_json(self) -> dict:
        runs = []
        for r in self.runs:
            t = r["t"]
            if t:
                runs.append({"wj": r["wj"], "t": t} if r["wj"] else {"t": t})
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
    checksum: str


@dataclass
class ParsedWork:
    meta: WorkMeta
    books: list[BookMeta]
    verses: list[VerseRow]
    headings: list[HeadingRow]
