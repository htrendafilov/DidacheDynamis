"""Strong's Greek/Hebrew lexicon adapters (plan/search_workspace.md §10.1).

Both CrossWire modules derive from James Strong, *Exhaustive Concordance of the Bible*
(1890), public domain by age. ``StrongsGreek`` 2.0 exports TEI ``<entryFree>`` records;
``StrongsHebrew`` 1.2 is a legacy plain-text export. Every entry normalizes to the
canonical identifier form (``normalize_strong_id``) that ``verse_tokens`` stores, so
KJV surface spans join to lexicon entries with no translation table.

Source quirks, handled deterministically and recorded in diagnostics:

- Greek: a ``00000`` front-matter record; placeholder entries whose definition is the
  ``@@@@<key>`` stub (letter-suffixed keys such as ``00031A`` and the numeric range
  above G5624); a few entries with editorial annotations but no ``<pron>``.
- Hebrew: the module predates UTF-8 — bytes decode as CP1252, and the 1996 ASCII e-text
  carries seven spurious ``&Š`` sequences (byte 0x8A) inside definitions. The adapter
  removes exactly that sequence and fails if the count changes, so a module update is
  reviewed rather than silently re-cleaned. The module has no Hebrew script: the lemma
  is the source's transliterated form (``'ab``), so ``transliteration`` stays NULL.
"""

from __future__ import annotations

import gzip
import hashlib
import re
from pathlib import Path

from defusedxml import ElementTree as DefusedET

from ..canonical import LexiconRow, norm_ws
from .study import _imp_entries

# Verified against the committed StrongsGreek 2.0 export: 5,742 records = 1 front matter
# (00000) + 252 '@@@@' placeholder stubs + 5,488 entries + G0251, which the module ships
# with a <def> but no <orth> lemma at all — recorded in diagnostics anomalies and skipped
# rather than given a fabricated lemma (KJV verses tagged G0251 simply have no entry).
EXPECTED_STRONGS_GREEK_ENTRIES = 5488
EXPECTED_STRONGS_HEBREW_ENTRIES = 8674
EXPECTED_HEBREW_BYTE_CLEANUPS = 7
EXPECTED_GREEK_SEQUENCE_GAPS = 135
EXPECTED_GREEK_CJK_ANNOTATIONS = 52
EXPECTED_GREEK_ANOMALIES = frozenset({("00251", "missing_lemma_or_definition")})
EXPECTED_GREEK_SEQUENCE_GAPS_SHA256 = (
    "cd743d8246b317cdd5ca44cd036621e82d7c274cc74f409d6d8e3ef52888488e"
)
EXPECTED_GREEK_CJK_IDS_SHA256 = (
    "148a508255395a346fa5566578b152558bb65ecfbbd59b327fc2cce8a38c50a9"
)

_MAX_IMP_BYTES = 128 * 1024 * 1024
_ENTRY_N = re.compile(r"^(?P<number>\d+)(?P<suffix>[A-Za-z]?)$")
_SEE_REF = re.compile(r"see\s+(?P<lang>GREEK|HEBREW)\s+for\s+(?P<number>\d+)(?P<suffix>[A-Za-z]?)")
_HEBREW_FIRST_LINE = re.compile(r"^\s*(?P<number>\d+)\s\s+(?P<lemma>.+?)\s\s+(?P<pron>\S.*?)\s*$")
_SPURIOUS = "&Š"  # CP1252 byte 0x8A in the Hebrew e-text; see module docstring


def _entry_id(raw: str, letter: str) -> str | None:
    """'0031a' -> 'G0031A', '1722' -> 'G1722' (lexicon keys carry no H/G letter)."""
    match = _ENTRY_N.match(raw.strip())
    if not match:
        return None
    return f"{letter}{int(match.group('number')):04d}{match.group('suffix').upper()}"


def _see_refs(text: str) -> list[str]:
    refs = []
    for match in _SEE_REF.finditer(text):
        letter = "G" if match.group("lang") == "GREEK" else "H"
        refs.append(f"{letter}{int(match.group('number')):04d}{match.group('suffix').upper()}")
    return refs


def _definition_text(def_element) -> str:
    """Plain definition text; <lb/> becomes a line break, lines are whitespace-normalized."""
    parts: list[str] = []

    def walk(node) -> None:
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "lb":
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(def_element)
    lines = [norm_ws(line).strip() for line in "".join(parts).split("\n")]
    return "\n".join(line for line in lines if line)


def _ids_sha256(values: list[str]) -> str:
    return hashlib.sha256("\n".join(values).encode()).hexdigest()


def load_strongs_greek(
    path: str | Path,
    *,
    expected_entries: int | None = EXPECTED_STRONGS_GREEK_ENTRIES,
    expected_sequence_gaps: int | None = EXPECTED_GREEK_SEQUENCE_GAPS,
    expected_cjk_annotations: int | None = EXPECTED_GREEK_CJK_ANNOTATIONS,
    expected_anomalies: frozenset[tuple[str, str]] | None = EXPECTED_GREEK_ANOMALIES,
) -> tuple[list[LexiconRow], dict]:
    """Parse the raw TEI mod2imp export of CrossWire StrongsGreek."""
    rows: list[LexiconRow] = []
    skipped_stubs = 0
    skipped_front_matter = 0
    anomalies: list[dict] = []
    module_numbers: set[int] = set()
    for key, text in _imp_entries(path):
        if not text:
            continue
        if key.strip().isdigit():
            module_numbers.add(int(key.strip()))
        if not text.lstrip().startswith("<entryFree"):
            anomalies.append({"key": key, "reason": "not_tei"})
            continue
        try:
            root = DefusedET.fromstring(
                text, forbid_dtd=True, forbid_entities=True, forbid_external=True
            )
        except Exception as exc:
            raise ValueError(f"malformed XML in StrongsGreek entry {key!r}") from exc
        raw_n = root.attrib.get("n", "")
        strong_id = _entry_id(raw_n, "G")
        if strong_id is None:
            anomalies.append({"key": key, "n": raw_n, "reason": "unparseable_n"})
            continue
        if strong_id == "G0000":
            skipped_front_matter += 1
            continue
        key_id = _entry_id(key, "G")
        if key_id is not None and key_id != strong_id:
            anomalies.append({"key": key, "n": raw_n, "reason": "key_n_mismatch"})
        lemma: str | None = None
        transliteration: str | None = None
        pronunciation: str | None = None
        def_element = None
        for child in root:
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "orth":
                orth_type = child.attrib.get("type")
                if orth_type is None and lemma is None:
                    lemma = norm_ws("".join(child.itertext())).strip()
                elif orth_type == "trans" and transliteration is None:
                    transliteration = norm_ws("".join(child.itertext())).strip()
            elif tag == "pron" and pronunciation is None:
                pronunciation = norm_ws("".join(child.itertext())).strip().strip("{}")
            elif tag == "def" and def_element is None:
                def_element = child
        if def_element is None:
            anomalies.append({"key": key, "reason": "missing_def"})
            continue
        definition = _definition_text(def_element)
        if "@@@@" in definition:
            skipped_stubs += 1  # CrossWire placeholder key (e.g. 00031A); no lexicon content
            continue
        if not lemma:
            lemma = transliteration
        if not lemma or not definition:
            anomalies.append({"key": key, "reason": "missing_lemma_or_definition"})
            continue
        rows.append(
            LexiconRow(
                strong_id=strong_id,
                language="grc",
                lemma=lemma,
                transliteration=transliteration,
                pronunciation=pronunciation or None,
                definition={"text": definition, "see": _see_refs(definition)},
                plain_text=norm_ws(definition.replace("\n", " ")).strip(),
            )
        )
    if expected_entries is not None and len(rows) != expected_entries:
        raise ValueError(
            f"StrongsGreek entry-count regression: expected {expected_entries}, parsed {len(rows)}"
        )
    # The module has holes in its key sequence (e.g. G3778 between G3777 and G3779, and
    # the G3203+ block) — entries the 1890 print has but this e-text never keyed. Report
    # them so a module update that fills gaps (or an importer bug that creates them) is
    # visible. G0251 is keyed but ships without a lemma, so it is an anomaly, not a hole.
    gaps = [f"G{n:04d}" for n in range(1, 5625) if n not in module_numbers]
    # 52 entries carry Chinese editorial annotations from the upstream e-text (e.g. G3588).
    # Imported verbatim — faithful to the source — and counted here for review.
    cjk = [
        row.strong_id
        for row in rows
        if any(
            "\u4e00" <= char <= "\u9fff"
            for char in (row.lemma + (row.pronunciation or "") + row.plain_text)
        )
    ]
    if expected_sequence_gaps is not None and len(gaps) != expected_sequence_gaps:
        raise ValueError(
            "StrongsGreek sequence-gap regression: "
            f"expected {expected_sequence_gaps}, found {len(gaps)}"
        )
    if (
        expected_sequence_gaps == EXPECTED_GREEK_SEQUENCE_GAPS
        and _ids_sha256(gaps) != EXPECTED_GREEK_SEQUENCE_GAPS_SHA256
    ):
        raise ValueError("StrongsGreek sequence-gap identity regression")
    if expected_cjk_annotations is not None and len(cjk) != expected_cjk_annotations:
        raise ValueError(
            "StrongsGreek CJK-annotation regression: "
            f"expected {expected_cjk_annotations}, found {len(cjk)}"
        )
    if (
        expected_cjk_annotations == EXPECTED_GREEK_CJK_ANNOTATIONS
        and _ids_sha256(cjk) != EXPECTED_GREEK_CJK_IDS_SHA256
    ):
        raise ValueError("StrongsGreek CJK-annotation identity regression")
    actual_anomalies = frozenset(
        (str(anomaly.get("key", "")), str(anomaly.get("reason", ""))) for anomaly in anomalies
    )
    if expected_anomalies is not None and actual_anomalies != expected_anomalies:
        raise ValueError(
            "StrongsGreek anomaly regression: "
            f"expected {sorted(expected_anomalies)}, found {sorted(actual_anomalies)}"
        )
    diag = {
        "format": "raw-tei",
        "entries": len(rows),
        "skipped_stubs": skipped_stubs,
        "skipped_front_matter": skipped_front_matter,
        "anomalies": anomalies,
        "sequence_gaps": {"count": len(gaps), "first": gaps[:64]},
        "cjk_annotated": {"count": len(cjk), "first": cjk[:64]},
    }
    return rows, diag


def load_strongs_hebrew(
    path: str | Path,
    *,
    expected_entries: int | None = EXPECTED_STRONGS_HEBREW_ENTRIES,
    expected_cleanups: int | None = EXPECTED_HEBREW_BYTE_CLEANUPS,
) -> tuple[list[LexiconRow], dict]:
    """Parse the plain-text mod2imp export of CrossWire StrongsHebrew (CP1252 bytes)."""
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    chunks: list[bytes] = []
    total = 0
    with opener(path, "rb") as handle:
        # Enforce the expanded-size ceiling while streaming (zip-bomb guard), the same
        # boundary the other IMP readers enforce per line.
        while chunk := handle.read(1 << 20):
            total += len(chunk)
            if total > _MAX_IMP_BYTES:
                raise ValueError(f"expanded IMP exceeds {_MAX_IMP_BYTES} byte limit: {path}")
            chunks.append(chunk)
    text = b"".join(chunks).decode("cp1252", errors="strict")
    cleanups = text.count(_SPURIOUS)
    if expected_cleanups is not None and cleanups != expected_cleanups:
        raise ValueError(
            f"StrongsHebrew spurious-sequence count changed: expected {expected_cleanups}, "
            f"found {cleanups} — review the module update before re-importing"
        )
    text = text.replace(_SPURIOUS, "")

    rows: list[LexiconRow] = []
    skipped_front_matter = 0
    anomalies: list[dict] = []
    module_numbers: set[int] = set()
    records = re.split(r"^\$\$\$", text, flags=re.MULTILINE)[1:]
    for record in records:
        first_newline = record.find("\n")
        if first_newline == -1:
            continue
        key = record[:first_newline].strip()
        body = record[first_newline + 1 :]
        if not key.isdigit() or int(key) == 0:
            skipped_front_matter += 1
            continue
        module_numbers.add(int(key))
        lines = body.splitlines()
        first = _HEBREW_FIRST_LINE.match(lines[0]) if lines else None
        if first is None:
            anomalies.append({"key": key, "reason": "unparseable_first_line"})
            continue
        # The module key is authoritative (it is how SWORD indexes the entry). H8483's
        # e-text first line misprints its own number as 8383; record and import by key.
        if int(first.group("number")) != int(key):
            anomalies.append(
                {"key": key, "n": first.group("number"), "reason": "key_number_mismatch"}
            )
        lemma = norm_ws(first.group("lemma")).strip()
        pronunciation = norm_ws(first.group("pron")).strip()
        definition = norm_ws(" ".join(line.strip() for line in lines[1:] if line.strip()))
        if not lemma or not definition:
            anomalies.append({"key": key, "reason": "missing_lemma_or_definition"})
            continue
        rows.append(
            LexiconRow(
                strong_id=f"H{int(key):04d}",
                language="hbo",
                lemma=lemma,
                transliteration=None,  # transliteration-only module; lemma holds that form
                pronunciation=pronunciation,
                definition={"text": definition, "see": _see_refs(definition)},
                plain_text=definition,
            )
        )
    if expected_entries is not None and len(rows) != expected_entries:
        raise ValueError(
            f"StrongsHebrew entry-count regression: expected {expected_entries}, parsed {len(rows)}"
        )
    # Gaps are computed over module keys (not imported rows), mirroring the Greek loader:
    # an anomaly-skipped entry is reported as an anomaly, not as a hole in the module.
    gaps = [f"H{n:04d}" for n in range(1, 8675) if n not in module_numbers]
    diag = {
        "format": "plain-cp1252",
        "entries": len(rows),
        "skipped_front_matter": skipped_front_matter,
        "spurious_sequences_removed": cleanups,
        "anomalies": anomalies,
        "sequence_gaps": {"count": len(gaps), "first": gaps[:64]},
    }
    return rows, diag
