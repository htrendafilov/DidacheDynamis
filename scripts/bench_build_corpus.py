#!/usr/bin/env python3
"""Build the M9.0b-1 estimator-calibration corpus.

Work order: plan/chat/m9.0b-1-estimator-calibration.md

Extracts ten sanitized prompts from the shipped content database and the CC0
Bulgarian 1689 Confession source, and writes plan/chat/bench/prompts.jsonl.

Every sample comes from a work whose ai_context_policy is 'allowed'
(public domain, CrossWire-licensed, or CC0). No Bulgarian scripture: see
the work order section 1a for why that exclusion is permanent.

Deterministic: same database in, same corpus out. Re-run after a content
rebuild to confirm the samples still resolve.

    python3 scripts/bench_build_corpus.py
"""

from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "content.sqlite"
BG_IMP = ROOT / "data" / "sources" / "BaptistConfession1689_BG.imp"
OUT = ROOT / "plan" / "chat" / "bench" / "prompts.jsonl"

# Works permitted in the corpus, with the policy that permits them. Asserted at
# runtime so a future content rebuild cannot quietly slip a licensed work in.
ALLOWED_WORKS = ("web", "mhc", "easton", "strongsgreek", "tsk")


def block_text(block: dict) -> str:
    """One CIR block -> plain text.

    A DocumentBlock carries BOTH a plain `text` and an optional structured
    `runs` holding the same content (apps/web/src/data/api.ts). Taking both
    double-counts every character and silently doubles the sample length, so
    prefer `runs` and fall back to `text`.
    """
    runs = block.get("runs")
    if isinstance(runs, list):
        return "".join(r.get("t", "") for r in runs if isinstance(r, dict))
    return block.get("text", "") if isinstance(block.get("text"), str) else ""


def flatten(doc: dict, kinds: tuple[str, ...] | None = None) -> str:
    """CIR Document -> plain text. Mirrors what SourceNormalizer must do.

    `kinds` filters block kinds — commentary needs `paragraph` only, because a
    Matthew Henry block opens with the quoted scripture as a `quotation` block
    and that is Bible text, not commentary prose.
    """
    blocks = doc.get("blocks")
    if isinstance(blocks, list):
        parts = [
            block_text(b)
            for b in blocks
            if isinstance(b, dict) and (kinds is None or b.get("kind") in kinds)
        ]
    else:  # strong_lexicon definitions are a bare {"text": ..., "see": [...]}
        parts = [doc.get("text", "")] if isinstance(doc.get("text"), str) else []
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def clip(text: str, target: int) -> str:
    """Trim to <= target chars on a word boundary, so samples stay natural text."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= target:
        return text
    cut = text[:target]
    space = cut.rfind(" ")
    return (cut[:space] if space > target * 0.6 else cut).rstrip(" ,;:.")


def bg_prose(chapter: str, target: int) -> tuple[str, str]:
    """A prose run from one named chapter of the CC0 Bulgarian Confession.

    Returns (source_label, text).

    Two things this has to get right. The confession interleaves proof
    references with prose, so a raw paragraph is half symbols and would measure
    as dense text rather than the prose sample it is meant to be. And a naive
    longest-run pick lands mid-sentence, which is not representative of anything
    the app would send. So: restrict to the requested chapter, drop the
    reference runs, then start at a sentence boundary.
    """
    raw = BG_IMP.read_text(encoding="utf-8")
    blocks = re.split(r"^\$\$\$", raw, flags=re.M)
    body = next((b for b in blocks if b.strip().startswith(chapter)), None)
    if body is None:
        raise SystemExit(f"chapter {chapter!r} not found in {BG_IMP.name}")

    text = re.sub(r"<[^>]+>", " ", body)
    text = re.sub(r"\s+", " ", text)
    # Reference runs look like "1 Кор. 8:4", "Пс. 90:2", "\\. 6" — drop any
    # digit-bearing token and keep the longest purely-prose island.
    islands = re.split(r"\S*\d\S*|\\\.", text)
    best = max(islands, key=lambda s: len(s.strip())).strip()

    # Start on a sentence: prefer a capital following terminal punctuation,
    # else the first capital letter in the run.
    match = re.search(r"[.;!?]\s+([А-ЯЁ][^.;!?]{20,})", best)
    if match:
        best = best[match.start(1):]
    else:
        cap = re.search(r"[А-ЯЁ]", best)
        if cap:
            best = best[cap.start():]
    return f"CC0 Bulgarian 1689 Confession, {chapter}", clip(best, target)


def counts(text: str) -> tuple[int, int]:
    non_ascii = sum(1 for ch in text if ord(ch) > 127)
    return len(text) - non_ascii, non_ascii


def main() -> int:
    if not DB.exists():
        print(f"missing {DB}; run `bibleimport build-all` first", file=sys.stderr)
        return 1
    if not BG_IMP.exists():
        print(f"missing {BG_IMP}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    policies = {
        r["id"]: r["ai_context_policy"]
        for r in conn.execute("SELECT id, ai_context_policy FROM works")
    }
    for work in ALLOWED_WORKS:
        policy = policies.get(work)
        if policy != "allowed":
            print(
                f"refusing to build: work '{work}' has ai_context_policy={policy!r}, "
                "expected 'allowed'",
                file=sys.stderr,
            )
            return 1

    samples: list[dict] = []

    def add(n, sid, kind, lang, source, text):
        ascii_n, non_ascii_n = counts(text)
        samples.append(
            {
                "n": n,
                "id": sid,
                "kind": kind,
                "lang": lang,
                "source": source,
                "chars": len(text),
                "ascii": ascii_n,
                "non_ascii": non_ascii_n,
                "text": text,
            }
        )

    # 1 — WEB passage prose.
    verses = conn.execute(
        "SELECT verse, plain_text FROM verses "
        "WHERE work_id='web' AND osis_code='John' AND chapter=3 AND verse BETWEEN 16 AND 18 "
        "ORDER BY verse"
    ).fetchall()
    add(1, "en-bible", "bible", "en", "WEB John 3:16-18",
        clip(" ".join(f"{r['verse']} {r['plain_text']}" for r in verses), 241))

    # 2, 8 — Matthew Henry prose, two distinct passages so neither carries the
    # prose divisor alone.
    for n, sid, osis, ch, vs, target in (
        (2, "en-commentary", "John", 3, 16, 232),
        (8, "en-commentary-2", "Ps", 23, 1, 240),
    ):
        # MHC keys each commentary block to the verse it starts at, so the block
        # covering a verse is the latest one starting at or before it.
        row = conn.execute(
            "SELECT verse_start, body_json FROM commentary_entries WHERE work_id='mhc' "
            "AND osis_code=? AND chapter=? AND verse_start<=? "
            "ORDER BY verse_start DESC LIMIT 1",
            (osis, ch, vs),
        ).fetchone()
        if row is None:
            print(f"no MHC entry covering {osis} {ch}:{vs}", file=sys.stderr)
            return 1
        add(n, sid, "commentary", "en", f"MHC {osis} {ch} (block at v{row['verse_start']})",
            clip(flatten(json.loads(row["body_json"]), kinds=("paragraph",)), target))

    # 3 — the dense-lexicon outlier: 2.15 chars/token, nearly pure ASCII, and the
    # single reason `dense` divisors exist at all.
    #
    # It has to be genuinely symbolic to do its job. Clipping the first 86
    # characters off a long prose entry yields ordinary prose density and
    # quietly destroys the sample — the divisor it justifies would then be
    # calibrated against text that does not exist in the corpus. So pick the
    # densest *short* entry: reference-and-abbreviation soup, which is exactly
    # what a real Easton's stub looks like.
    dense_rows = [
        (r["headword"], flatten(json.loads(r["body_json"])))
        for r in conn.execute(
            "SELECT headword, body_json FROM dictionary_entries WHERE work_id='easton'"
        )
    ]
    def density(text: str) -> float:
        return sum(ch.isdigit() or ch in ".,;:()-=" for ch in text) / max(len(text), 1)

    candidates = [(density(t), hw, t) for hw, t in dense_rows if 70 <= len(t) <= 100]
    if not candidates:
        print("no short Easton's entry in the 70-100 char band", file=sys.stderr)
        return 1
    _, headword, text = max(candidates)
    add(3, "en-lexicon", "lexicon", "en", f"Easton's: {headword}", text)

    # 4, 5, 6 — user questions. Composed, not extracted: these represent what a
    # reader types, and no shipped work contains them.
    add(4, "bg-question", "question", "bg", "composed",
        "Какво означава думата „единороден“ в Йоан 3:16 и защо различните български "
        "преводи я предават по различен начин в този стих?")
    add(5, "bg-plus-en", "question", "mixed", "composed",
        "Explain what \"only begotten\" means in John 3:16 — какво точно казва гръцкият "
        "текст и как да го преведа на български?")
    add(6, "bg-long", "question", "bg", "composed",
        "Обясни ми разликата между оправданието и освещението според Писанието, като "
        "посочиш кои стихове говорят за всяко от тях, защо богословите ги разграничават "
        "толкова внимателно и какво следва от това разграничение за живота на вярващия.")

    # 7 — a real Strong's entry: ids, cross-references, abbreviations, Greek.
    row = conn.execute(
        "SELECT strong_id, lemma, transliteration, pronunciation, definition_json "
        "FROM strong_lexicon WHERE strong_id='G3439'"
    ).fetchone()
    definition = flatten(json.loads(row["definition_json"]))
    add(7, "en-strongs", "lexicon", "en", "Strong's G3439",
        clip(f"{row['strong_id']} {row['lemma']} ({row['transliteration']}, "
             f"{row['pronunciation']}): {definition}", 240))

    # 9 — TSK: the densest reference-only text the app ever sends.
    refs = conn.execute(
        "SELECT target_ref FROM xrefs WHERE osis_code='John' AND chapter=3 AND verse=16 "
        "ORDER BY votes DESC, target_ref LIMIT 14"
    ).fetchall()
    add(9, "en-xref", "xref", "en", "TSK John 3:16",
        clip("John 3:16 cross-references: " + "; ".join(r["target_ref"] for r in refs), 240))

    # 10 — Bulgarian prose. CC0 Confession, NOT scripture (work order section 1a).
    label, prose = bg_prose("/Chapter 2", 244)
    add(10, "bg-prose", "prose", "bg", label, prose)

    samples.sort(key=lambda s: s["n"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as fh:
        for sample in samples:
            fh.write(json.dumps(sample, ensure_ascii=False) + "\n")

    print(f"wrote {OUT.relative_to(ROOT)} ({len(samples)} prompts)")
    print(f"{'#':>2} {'id':<16} {'kind':<11} {'chars':>6} {'ascii':>6} {'non-ascii':>10}")
    for s in samples:
        print(f"{s['n']:>2} {s['id']:<16} {s['kind']:<11} {s['chars']:>6} "
              f"{s['ascii']:>6} {s['non_ascii']:>10}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
