"""Strong's normalization shared by the runtime lexicon and search routes."""

from __future__ import annotations

import re
import unicodedata

_STRONG_ID = re.compile(r"^(?P<letter>[HGhg])(?P<number>[0-9]{1,5})(?P<suffix>[A-Za-z]?)$")
_SEARCH_TOKEN = re.compile(r"\w+", re.UNICODE)

WORK_BY_LETTER = {"G": "strongsgreek", "H": "strongshebrew"}


def normalize_strong_id(value: str) -> str | None:
    """Normalize bounded public input to G/H + four digits + optional suffix."""
    match = _STRONG_ID.match(value.strip())
    if not match:
        return None
    return (
        f"{match.group('letter').upper()}"
        f"{int(match.group('number')):04d}"
        f"{match.group('suffix').upper()}"
    )


def normalize_lexical_search(value: str) -> str:
    """Match the importer's NFKD case/diacritic fold for structured search.

    Deliberately duplicated from `bibleimport.canonical.normalize_lexical_search`: the API
    never imports the importer (see AGENTS.md). Both sides must fold identically or a
    folded query stops matching the folded columns — `test_strongs_entry_search_normalizes_
    id_and_folds_diacritics` builds its fixture through the importer, so drift fails there.
    """
    decomposed = unicodedata.normalize("NFKD", value)
    folded = "".join(char for char in decomposed if unicodedata.category(char) != "Mn")
    return " ".join(folded.casefold().split())


def lexical_tokens(value: str) -> list[str]:
    return _SEARCH_TOKEN.findall(normalize_lexical_search(value))
