"""Structural validation + the versification-alignment hook.

M1 validates one Bible's internal integrity and reports stats. The alignment function is
the readiness hook for M6 (Bulgarian): given two translations' verse keys it reports refs
present in one but not the other, so the importer can flag mismatches instead of silently
renumbering (plan/00_system_design.md §4).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .books import CANON
from .canonical import BookMeta, HeadingRow, VerseRow


@dataclass
class Diagnostics:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
    alignment: dict[str, object] | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


def validate(books: list[BookMeta], verses: list[VerseRow], headings: list[HeadingRow]) -> Diagnostics:
    d = Diagnostics()
    seen: set[tuple[str, int, int]] = set()
    per_book: dict[str, int] = {}

    for v in verses:
        key = (v.osis, v.chapter, v.verse)
        if key in seen:
            d.errors.append(f"duplicate verse {v.osis} {v.chapter}:{v.verse}")
        seen.add(key)
        if v.chapter <= 0 or v.verse <= 0:
            d.errors.append(f"non-positive ref {v.osis} {v.chapter}:{v.verse}")
        if not v.plain_text.strip():
            d.warnings.append(f"empty verse {v.osis} {v.chapter}:{v.verse}")
        per_book[v.osis] = per_book.get(v.osis, 0) + 1

    present = {b.osis for b in books}
    expected = {b.osis for b in CANON}
    missing = [b.osis for b in CANON if b.osis not in present]
    if missing:
        d.warnings.append(f"missing canonical books: {', '.join(missing)}")
    extra = present - expected
    if extra:
        d.warnings.append(f"non-canonical books present: {', '.join(sorted(extra))}")

    # chapter-gap check within each book
    by_book_ch: dict[str, set[int]] = {}
    for v in verses:
        by_book_ch.setdefault(v.osis, set()).add(v.chapter)
    for b in books:
        chs = by_book_ch.get(b.osis, set())
        if chs:
            gaps = [c for c in range(1, max(chs) + 1) if c not in chs]
            if gaps:
                d.warnings.append(f"{b.osis}: missing chapters {gaps}")

    d.stats = {
        "books": len(books),
        "verses": len(verses),
        "headings": len(headings),
        "per_book": per_book,
    }
    return d


def align_versification(
    base_keys: set[tuple[str, int, int]],
    other_keys: set[tuple[str, int, int]],
) -> dict[str, list[tuple[str, int, int]]]:
    """Report refs in base missing from other, and vice versa (for EN<->BG alignment)."""
    return {
        "missing_in_other": sorted(base_keys - other_keys),
        "missing_in_base": sorted(other_keys - base_keys),
    }
