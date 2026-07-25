"""CrossWire Easton dictionary adapter: raw TEI ``<entryFree>`` and legacy stripped IMP.

The raw export (official ``mod2imp Easton``) carries structured references the stripped
export lost: ``<ref osisRef="Bible:…">`` scripture citations and ``<ref target="Easton:…">``
internal dictionary links. This adapter converts them to Document CIR runs (``ref`` /
``dictionary_ref``) and classifies every reference element in diagnostics.

Reference policy (plan/easton_dictionary_references.md):

- Scripture targets are validated against their visible label and the paragraph citation
  context; shorthand (``c:v`` / verse-only) inherits only from the last resolved reference
  in the same paragraph. Deterministic corrections are recorded raw+derived; anything
  irreconcilable stays visible plain text with a diagnostic — never a guessed link.
- Internal references resolve by exact module entry key only (no fuzzy/alias matching).
  Ambiguous duplicate keys (KADESH, SALMON) and missing keys stay plain text.
- ``ref`` and ``dictionary_ref`` are mutually exclusive per run (import-time validated).
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import NamedTuple

from defusedxml import ElementTree as DefusedET

from ..books import BY_OSIS, normalize_osis_ref
from ..canonical import DictionaryRow, norm_ws
from .study import _imp_entries
from .study import load_sword_dictionary as _load_stripped

EXPECTED_EASTON_ENTRIES = 3963

# Books cited by verse alone ("Jude 1" = verse 1, encoded by SWORD as Jude.1.1).
_SINGLE_CHAPTER_BOOKS = frozenset({"Obad", "Phlm", "2John", "3John", "Jude"})

# Book tokens as they appear in Easton's visible labels (abbreviations and full names).
# Closed inventory audited against the raw export; every label book token maps to exactly
# one canonical OSIS code. Targets are never resolved through this table — it only
# validates the label claim against the raw target and local context.
_BOOK_ALIASES = {
    "Gen.": "Gen",
    "Ge.": "Gen",
    "Ge": "Gen",
    "Ex.": "Exod",
    "Ex": "Exod",
    "Exodus": "Exod",
    "Lev.": "Lev",
    "Num.": "Num",
    "Nu.": "Num",
    "Deut.": "Deut",
    "Josh.": "Josh",
    "Judg.": "Judg",
    "Ruth": "Ruth",
    "1 Sam": "1Sam",
    "1 Sam.": "1Sam",
    "2 Sam": "2Sam",
    "2 Sam.": "2Sam",
    "2Sa": "2Sam",
    "1 Kings": "1Kgs",
    "2 King": "2Kgs",
    "2 Kings": "2Kgs",
    "1 Ch.": "1Chr",
    "1 Chr.": "1Chr",
    "1 Chron.": "1Chr",
    "1Ch": "1Chr",
    "2 Chr": "2Chr",
    "2 Chr.": "2Chr",
    "2 Chron.": "2Chr",
    "2Chr.": "2Chr",
    "2Ch": "2Chr",
    "Ezra": "Ezra",
    "Neh.": "Neh",
    "Esther": "Esth",
    "Job": "Job",
    "Job.": "Job",
    "Ps": "Ps",
    "Ps.": "Ps",
    "Psalm": "Ps",
    "Psalms": "Ps",
    "Prov.": "Prov",
    "Eccl.": "Eccl",
    "Eccles.": "Eccl",
    "Cant.": "Song",
    "Isa": "Isa",
    "Isa.": "Isa",
    "Jer.": "Jer",
    "Lam.": "Lam",
    "Ezek": "Ezek",
    "Ezek.": "Ezek",
    "Dan": "Dan",
    "Dan.": "Dan",
    "Daniel": "Dan",
    "Hos.": "Hos",
    "Joel": "Joel",
    "Amos": "Amos",
    "Obad.": "Obad",
    "Jonah": "Jonah",
    "Micah": "Mic",
    "Nah.": "Nah",
    "Nahum": "Nah",
    "Hab.": "Hab",
    "Zeph.": "Zeph",
    "Hag.": "Hag",
    "Zech.": "Zech",
    "Mal.": "Mal",
    "Mat.": "Matt",
    "Matt.": "Matt",
    "Matthew": "Matt",
    "Mark": "Mark",
    "Luke": "Luke",
    "John": "John",
    "John.": "John",
    "Act": "Acts",
    "Acts": "Acts",
    "Acts.": "Acts",
    "Rom.": "Rom",
    "Romans": "Rom",
    "1 Cor.": "1Cor",
    "2 Cor.": "2Cor",
    "Gal": "Gal",
    "Gal.": "Gal",
    "Eph": "Eph",
    "Eph.": "Eph",
    "Phil.": "Phil",
    "Col": "Col",
    "Col.": "Col",
    "1 Thes.": "1Thess",
    "1 Thess.": "1Thess",
    "1Thess.": "1Thess",
    "2 Thess.": "2Thess",
    "1 Tim.": "1Tim",
    "2 Tim.": "2Tim",
    "Titus": "Titus",
    "Philemon": "Phlm",
    "Heb.": "Heb",
    "James": "Jas",
    "1 Pet.": "1Pet",
    "1 Peter": "1Pet",
    "2 Pet.": "2Pet",
    "1 John": "1John",
    "2 John": "2John",
    "3 John": "3John",
    "Jude": "Jude",
    "Rev.": "Rev",
    "1 Macc.": "1Macc",
}
_BOOK_LABEL = re.compile(
    r"^("
    + "|".join(re.escape(a) for a in sorted(_BOOK_ALIASES, key=len, reverse=True))
    + r")\s+(.*)$"
)
_FULL_LABEL = re.compile(r"(\d+):\s*(\d+)(?:\s*-\s*(\d+))?")
_NUM_LABEL = re.compile(r"(\d+)(?:\s*-\s*(\d+))?")
_WS = re.compile(r"\s+")

_ENTRY_TAG = "entryFree"
_ALLOWED_TAGS = {"entryFree", "title", "p", "ref", "foreign"}


class _LabelClaim(NamedTuple):
    """Parsed visible label; kind is full|chapter|verse|bad."""

    kind: str
    book: str | None
    chapter: int | None
    v1: int | None
    v2: int | None


def _parse_label(label: str) -> _LabelClaim:
    match = _BOOK_LABEL.match(label)
    book = _BOOK_ALIASES[match.group(1)] if match else None
    rest = match.group(2) if match else label
    full = _FULL_LABEL.fullmatch(rest)
    if full:
        return _LabelClaim(
            "full",
            book,
            int(full.group(1)),
            int(full.group(2)),
            int(full.group(3)) if full.group(3) else None,
        )
    num = _NUM_LABEL.fullmatch(rest)
    if num:
        n1 = int(num.group(1))
        n2 = int(num.group(2)) if num.group(2) else None
        if book is not None and n2 is None:
            return _LabelClaim("chapter", book, n1, None, None)
        if book is None:
            return _LabelClaim("verse", None, None, n1, n2)
    return _LabelClaim("bad", book, None, None, None)


def _fmt(book: str, chapter: int, v1: int, v2: int | None) -> str:
    ref = f"{book}.{chapter}.{v1}"
    if v2 is not None and v2 > v1:
        ref += f"-{v2}"
    return ref


class _Diagnostics:
    """Classifies every reference element; nothing is dropped silently."""

    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self.corrections: list[dict] = []
        self.unsupported: list[dict] = []
        self.unreconciled: list[dict] = []
        self.ambiguous: list[dict] = []
        self.missing: list[dict] = []
        self.duplicate_keys: dict[str, int] = {}
        self.foreign_runs = 0
        self.entries = 0
        # Every <ref> element the parser walked, counted from the tree rather than from the
        # raw bytes, so the classification gate cannot be fooled by markup formatting.
        self.ref_elements = 0

    def summary(self) -> dict:
        bible_linked = self.counts["bible_linked"]
        return {
            "format": "raw-tei",
            "entries": self.entries,
            "reference_elements": self.ref_elements,
            "duplicate_keys": dict(sorted(self.duplicate_keys.items())),
            "foreign_runs": self.foreign_runs,
            "bible_refs": {
                "total": bible_linked
                + self.counts["corrected"]
                + self.counts["unsupported_book"]
                + self.counts["unreconciled"],
                "linked": bible_linked,
                "chapter_only": self.counts["chapter_only"],
                "chapter_via_range": self.counts["chapter_via_range"],
                "single_chapter_book": self.counts["single_chapter_book"],
                "corrected": self.counts["corrected"],
                "unsupported_book": self.counts["unsupported_book"],
                "unreconciled": self.counts["unreconciled"],
            },
            "easton_refs": {
                "total": self.counts["easton_linked"]
                + self.counts["easton_ambiguous"]
                + self.counts["easton_missing"],
                "linked": self.counts["easton_linked"],
                "ambiguous": self.counts["easton_ambiguous"],
                "missing": self.counts["easton_missing"],
            },
            "corrections": self.corrections,
            "unsupported": self.unsupported,
            "unreconciled": self.unreconciled,
            "ambiguous_targets": self.ambiguous,
            "missing_targets": self.missing,
        }


class _RefResolver:
    """Resolves one entry's references; the paragraph anchor resets on each <p>."""

    def __init__(self, key_index: dict[str, list[str]], entry_key: str, diag: _Diagnostics) -> None:
        self._key_index = key_index
        self._entry = entry_key
        self._diag = diag
        self._anchor: tuple[str, int, int | None] | None = None

    @property
    def entry_key(self) -> str:
        return self._entry

    def reset_paragraph(self) -> None:
        self._anchor = None

    def resolve(self, element) -> dict:
        target = element.attrib.get("target")
        if target is not None:
            return self._easton(target, _label_text(element))
        return self._bible(element.attrib.get("osisRef", ""), _label_text(element))

    def _easton(self, target: str, label: str) -> dict:
        diag = self._diag
        entry_key = target.split(":", 1)[1] if ":" in target else target
        headwords = self._key_index.get(entry_key, [])
        if len(headwords) == 1:
            diag.counts["easton_linked"] += 1
            return {
                "t": label,
                "dictionary_ref": {
                    "work_id": "easton",
                    "entry_key": entry_key,
                    "headword": headwords[0],
                },
            }
        run = {"t": label}
        if headwords:
            diag.counts["easton_ambiguous"] += 1
            diag.ambiguous.append({"entry": self._entry, "target": entry_key, "label": label})
        else:
            diag.counts["easton_missing"] += 1
            diag.missing.append({"entry": self._entry, "target": entry_key, "label": label})
        return run

    def _bible(self, osis_ref: str, label: str) -> dict:
        diag = self._diag
        raw = osis_ref.split(":", 1)[1] if ":" in osis_ref else osis_ref
        raw_book = raw.split("-")[0].split(".")[0]
        if raw_book not in BY_OSIS:
            diag.counts["unsupported_book"] += 1
            diag.unsupported.append({"entry": self._entry, "raw": raw, "label": label})
            self._anchor = None
            return {"t": label}
        raw_target = normalize_osis_ref(raw)
        if raw_target is None:
            self._unreconciled(raw, label, "unnormalizable_target")
            return {"t": label}
        claim = _parse_label(label)
        if claim.kind == "full" and claim.book is not None:
            derived = _fmt(claim.book, claim.chapter or 0, claim.v1 or 0, claim.v2)
            if derived == raw_target:
                diag.counts["bible_linked"] += 1
                self._anchor = (claim.book, claim.chapter or 0, claim.v1)
                return self._run(label, derived)
            self._unreconciled(raw, label, "explicit_mismatch", derived=derived)
            return {"t": label}
        if claim.kind == "chapter":
            book, chapter = claim.book or "", claim.chapter or 0
            if raw_target == f"{book}.{chapter}":
                diag.counts["bible_linked"] += 1
                diag.counts["chapter_only"] += 1
                self._anchor = (book, chapter, None)
                return self._run(label, raw_target)
            if re.fullmatch(rf"{re.escape(book)}\.{chapter}\.1-\d+", raw_target):
                diag.counts["bible_linked"] += 1
                diag.counts["chapter_via_range"] += 1
                self._anchor = (book, chapter, 1)
                return self._run(label, raw_target)
            if book in _SINGLE_CHAPTER_BOOKS and raw_target == f"{book}.1.{chapter}":
                # Single-chapter books are cited by verse alone: "Jude 1" = Jude.1.1.
                diag.counts["bible_linked"] += 1
                diag.counts["single_chapter_book"] += 1
                self._anchor = (book, 1, chapter)
                return self._run(label, raw_target)
            self._unreconciled(raw, label, "chapter_mismatch")
            return {"t": label}
        if claim.kind == "full":  # shorthand c:v — inherits the anchor book only
            if self._anchor is None:
                self._unreconciled(raw, label, "no_paragraph_context")
                return {"t": label}
            derived = _fmt(self._anchor[0], claim.chapter or 0, claim.v1 or 0, claim.v2)
            self._anchor = (self._anchor[0], claim.chapter or 0, claim.v1)
            return self._derived_run(raw, raw_target, label, derived)
        if claim.kind == "verse":  # shorthand v(-v) — inherits anchor book + chapter
            if self._anchor is None:
                self._unreconciled(raw, label, "no_paragraph_context")
                return {"t": label}
            book_a, chapter_a, _ = self._anchor
            derived = _fmt(book_a, chapter_a, claim.v1 or 0, claim.v2)
            self._anchor = (book_a, chapter_a, claim.v1)
            return self._derived_run(raw, raw_target, label, derived)
        self._unreconciled(raw, label, "unparseable_label")
        return {"t": label}

    def _derived_run(self, raw: str, raw_target: str, label: str, derived: str) -> dict:
        if derived == raw_target:
            self._diag.counts["bible_linked"] += 1
        else:
            self._diag.counts["corrected"] += 1
            self._diag.corrections.append(
                {
                    "entry": self._entry,
                    "raw": raw,
                    "derived": derived,
                    "label": label,
                }
            )
        return self._run(label, derived)

    def _unreconciled(self, raw: str, label: str, reason: str, derived: str | None = None) -> None:
        self._diag.counts["unreconciled"] += 1
        record = {"entry": self._entry, "raw": raw, "label": label, "reason": reason}
        if derived:
            record["derived"] = derived
        self._diag.unreconciled.append(record)
        self._anchor = None

    @staticmethod
    def _run(label: str, ref: str | None) -> dict:
        return {"t": label, "ref": ref} if ref else {"t": label}


def _label_text(element) -> str:
    return _WS.sub(" ", "".join(element.itertext())).strip()


def _append_run(runs: list[dict], run: dict) -> None:
    if not run["t"]:
        return
    if "ref" in run and "dictionary_ref" in run:
        raise ValueError("run carries both ref and dictionary_ref")
    previous = runs[-1] if runs else None
    if (
        previous
        and "ref" not in run
        and "dictionary_ref" not in run
        and "ref" not in previous
        and "dictionary_ref" not in previous
        and previous.get("emphasis", False) == run.get("emphasis", False)
    ):
        previous["t"] += run["t"]
        return
    runs.append(run)


def _collect_runs(
    runs: list[dict], element, resolver: _RefResolver, diag: _Diagnostics, *, emphasis: bool = False
) -> None:
    tag = element.tag
    if tag not in _ALLOWED_TAGS:
        raise ValueError(f"unsafe or unknown markup <{tag}> in entry {resolver.entry_key!r}")
    if tag == "ref":
        diag.ref_elements += 1
        # The tail is appended by the enclosing loop so it is emitted exactly once.
        run = resolver.resolve(element)
        if emphasis:
            run = {**run, "emphasis": True}
        _append_run(runs, run)
        return
    if tag == "foreign":
        diag.foreign_runs += 1
        emphasis = True
    if element.text:
        _append_run(runs, {"t": element.text, **({"emphasis": True} if emphasis else {})})
    for child in element:
        _collect_runs(runs, child, resolver, diag, emphasis=emphasis)
        if child.tail:
            _append_run(runs, {"t": child.tail, **({"emphasis": True} if emphasis else {})})


def _parse_entry(
    key: str, text: str, key_index: dict[str, list[str]], diag: _Diagnostics
) -> DictionaryRow | None:
    try:
        root = DefusedET.fromstring(
            text, forbid_dtd=True, forbid_entities=True, forbid_external=True
        )
    except Exception as exc:
        raise ValueError(f"malformed XML in Easton entry {key!r}") from exc
    if root.tag != _ENTRY_TAG:
        raise ValueError(f"expected <entryFree> root in Easton entry {key!r}, got <{root.tag}>")
    if root.text and root.text.strip():
        raise ValueError(f"unexpected text outside <p> in Easton entry {key!r}")
    headword = (root.attrib.get("n") or "").strip()
    blocks: list[dict] = []
    resolver = _RefResolver(key_index, key, diag)
    seen_title = False
    for child in root:
        if child.tag not in _ALLOWED_TAGS:
            raise ValueError(f"unsafe or unknown markup <{child.tag}> in entry {key!r}")
        if child.tail and child.tail.strip():
            raise ValueError(f"unexpected text outside <p> in Easton entry {key!r}")
        if child.tag == "title":
            seen_title = True
            if not headword:
                headword = _label_text(child)
            continue  # the title duplicates the headword; consumed, not emitted
        if child.tag != "p":
            raise ValueError(f"unexpected <{child.tag}> in Easton entry {key!r}")
        resolver.reset_paragraph()
        runs: list[dict] = []
        _collect_runs(runs, child, resolver, diag)
        runs, plain = _finish_runs(runs)
        if plain:
            blocks.append({"kind": "paragraph", "text": plain, "runs": runs})
    if not seen_title:
        raise ValueError(f"missing <title> in Easton entry {key!r}")
    if not headword or not blocks:
        return None
    plain_text = "\n\n".join(block["text"] for block in blocks)
    return DictionaryRow(
        headword=headword,
        sort_key=headword.casefold(),
        language="en",
        body={"blocks": blocks},
        plain_text=plain_text,
    )


def _finish_runs(runs: list[dict]) -> tuple[list[dict], str]:
    if not runs:
        return [], ""
    runs[0]["t"] = runs[0]["t"].lstrip()
    runs[-1]["t"] = runs[-1]["t"].rstrip()
    runs = [run for run in runs if run["t"]]
    for run in runs:
        if "ref" in run and "dictionary_ref" in run:
            raise ValueError("run carries both ref and dictionary_ref")
    plain = norm_ws("".join(run["t"] for run in runs)).strip()
    return runs, plain


def load_raw_easton(
    path: str | Path, *, expected_entries: int | None = None, language: str = "en"
) -> tuple[list[DictionaryRow], dict]:
    """Parse the raw TEI IMP export; returns (rows, diagnostics)."""
    records = list(_imp_entries(path))
    # Index every module key before resolving internal references.
    key_index: dict[str, list[str]] = defaultdict(list)
    roots: list[tuple[str, str]] = []
    for key, text in records:
        if not text:
            continue
        roots.append((key, text))
        if text.lstrip().startswith("<entryFree"):
            match = re.match(r"\s*<entryFree\s+n=\"([^\"]*)\"", text)
            key_index[key].append(match.group(1) if match else "")
    diag = _Diagnostics()
    rows: list[DictionaryRow] = []
    for key, text in roots:
        if not text.lstrip().startswith("<"):
            raise ValueError(f"expected raw TEI <entryFree> record for Easton key {key!r}")
        row = _parse_entry(key, text, key_index, diag)
        if row is not None:
            row.language = language
            rows.append(row)
    diag.entries = len(rows)
    diag.duplicate_keys = {k: len(v) for k, v in key_index.items() if len(v) > 1}
    if expected_entries is not None and len(rows) != expected_entries:
        raise ValueError(
            f"Easton entry-count regression: expected {expected_entries}, parsed {len(rows)}"
        )
    classified = (
        diag.counts["bible_linked"]
        + diag.counts["corrected"]
        + diag.counts["unsupported_book"]
        + diag.counts["unreconciled"]
        + diag.counts["easton_linked"]
        + diag.counts["easton_ambiguous"]
        + diag.counts["easton_missing"]
    )
    if classified != diag.ref_elements:
        raise ValueError(
            f"unclassified reference elements: {diag.ref_elements - classified} of "
            f"{diag.ref_elements}"
        )
    return rows, diag.summary()


def load_dictionary_imp(
    path: str | Path,
    *,
    expected_entries: int | None = None,
    language: str = "en",
) -> tuple[list[DictionaryRow], dict]:
    """Load a SWORD IMP dictionary, dispatching on raw TEI vs stripped plain content."""
    path = Path(path)
    for _, text in _imp_entries(path):
        if text:
            # Raw TEI records are XML documents; legacy stripped records start
            # with the headword text and never with markup. Reusing the streaming
            # IMP reader also enforces its expanded-size ceiling while sniffing.
            if text.lstrip().startswith("<"):
                return load_raw_easton(
                    path, expected_entries=expected_entries, language=language
                )
            break
    rows = _load_stripped(path, language)
    if expected_entries is not None and len(rows) != expected_entries:
        raise ValueError(
            f"Easton entry-count regression: expected {expected_entries}, parsed {len(rows)}"
        )
    return rows, {"format": "stripped", "entries": len(rows)}
