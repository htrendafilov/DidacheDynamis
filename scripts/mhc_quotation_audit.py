#!/usr/bin/env python3
"""Measure the Matthew Henry `quotation` block heuristic (MHC translation plan, M1).

`study.py` labels a block `quotation` when any of its runs is superscript, not by detecting
Scripture. D3 — how quotation blocks are translated — is decided against this measurement, and
§8.3's QA checks depend on it, so the error rate has to be a number rather than an impression.

Two directions, measured differently because they fail differently:

* **False positives** — a block marked `quotation` that is not Scripture. Bounded here by
  checking what the superscripts actually are, then sampling for review.
* **False negatives** — Scripture quoted without verse numbers, so labelled `paragraph`. This is
  the one that matters: the plan notes a false negative means Scripture translated under
  paragraph rules. Measured against the KJV already in `content.sqlite` — an independent source,
  not the heuristic's own signal — by looking for verbatim n-gram overlap.

Usage:
    python3 scripts/mhc_quotation_audit.py --db data/content.sqlite [--sample-out sample.jsonl]
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "importer"))

from bibleimport.formats.study import load_sword_commentary

# Long enough that ordinary English prose does not collide with a verse by chance, short enough
# to catch a partial quotation. Henry quotes clauses, not always whole verses.
NGRAM = 8
SAMPLE_PER_STRATUM = 60
SEED = 20260811  # fixed so the published rates are reproducible


def _norm(text: str) -> list[str]:
    return re.sub(r"[^a-z\s]", " ", text.lower()).split()


def _ngrams(words: list[str], n: int) -> set[tuple[str, ...]]:
    return {tuple(words[i : i + n]) for i in range(len(words) - n + 1)}


def _matched_word_count(words: list[str], reference: set[tuple[str, ...]], n: int) -> int:
    """Words inside at least one matching n-gram, counted once each.

    Not `unique_ngrams + n - 1`: that assumes every match forms a single contiguous span, so it
    undercounts a block quoting two separate verses and overcounts nothing — the earlier figure
    was a lower bound presented as an estimate.
    """
    covered: set[int] = set()
    for i in range(len(words) - n + 1):
        if tuple(words[i : i + n]) in reference:
            covered.update(range(i, i + n))
    return len(covered)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default="data/content.sqlite")
    ap.add_argument("--source", default="data/sources/MHC.imp.gz")
    ap.add_argument("--sample-out", default="")
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    bible = set()
    for (text,) in conn.execute("SELECT plain_text FROM verses WHERE work_id='kjv'"):
        bible |= _ngrams(_norm(text), NGRAM)
    print(f"KJV reference n-grams (n={NGRAM}): {len(bible):,}")

    rows = load_sword_commentary([args.source])
    quotation: list[dict] = []
    paragraph: list[dict] = []
    sup_shapes: Counter[str] = Counter()

    for row in rows:
        for block in row.body["blocks"]:
            runs = block.get("runs", [])
            sups = [r.get("t", "").strip() for r in runs if r.get("superscript")]
            words = _norm(block.get("text", ""))
            overlap = len(_ngrams(words, NGRAM) & bible) if len(words) >= NGRAM else 0
            covered = _matched_word_count(words, bible, NGRAM) if overlap else 0
            rec = {
                "ref": f"{row.osis} {row.chapter}:{row.verse_start}",
                "kind": block["kind"],
                "words": len(words),
                "scripture_ngrams": overlap,
                "scripture_words": covered,
                "superscripts": sups[:5],
                "text": block.get("text", "")[:300],
            }
            if block["kind"] == "quotation":
                quotation.append(rec)
                for s in sups:
                    sup_shapes["numeric" if re.fullmatch(r"\d+", s) else f"other:{s!r}"] += 1
            elif block["kind"] == "paragraph":
                paragraph.append(rec)

    print(f"\nblocks: {len(quotation):,} quotation, {len(paragraph):,} paragraph")
    print("superscript shapes inside quotation blocks:")
    for shape, n in sup_shapes.most_common(5):
        print(f"  {shape:<24} {n:,}")

    # False negatives: paragraph blocks carrying verbatim Scripture.
    fn = [r for r in paragraph if r["scripture_ngrams"] > 0]
    fn_rate = len(fn) / len(paragraph) if paragraph else 0.0
    print(f"\nFALSE NEGATIVES — paragraph blocks containing a verbatim {NGRAM}-gram of KJV:")
    print(f"  {len(fn):,} of {len(paragraph):,} = {100 * fn_rate:.2f}%")
    # How much text this is, not just how many blocks. A block "containing" Scripture is usually
    # commentary prose with a quoted clause inside it, not a quotation in disguise — the policy
    # D3 needs is about inline fragments, and their share of the words is the honest scale.
    para_words = sum(r["words"] for r in paragraph)
    matched_words = sum(r["scripture_words"] for r in fn)
    print(f"  affected words: {matched_words:,} of {para_words:,} paragraph words "
          f"= {100 * matched_words / para_words:.2f}%")
    print("   (a LOWER bound: this counts only verbatim 8-gram matches, so quotations shorter")
    print("    than 8 words, and Henry's loose or modernised quotations, are not detected)")

    # False positives: quotation blocks with no Scripture overlap at all.
    fp = [r for r in quotation if r["scripture_ngrams"] == 0]
    fp_rate = len(fp) / len(quotation) if quotation else 0.0
    print("\nFALSE POSITIVES — quotation blocks with no verbatim KJV overlap:")
    print(f"  {len(fp):,} of {len(quotation):,} = {100 * fp_rate:.2f}%")
    print("  (an upper bound: Henry quotes loosely and modernises spelling, so a block can be")
    print("   a genuine quotation and still miss an exact n-gram match)")

    if args.sample_out:
        # Four strata, not two. Sampling only the *suspected* errors cannot measure the
        # heuristic: with zero detected false positives it produced no quotation blocks at all,
        # so nothing about the label itself was ever reviewable. Every stratum is drawn here,
        # including the blocks the automated signals call correct — those are exactly where an
        # undetected error would hide.
        rng = random.Random(SEED)
        strata = {
            "quotation_with_overlap": [r for r in quotation if r["scripture_ngrams"] > 0],
            "quotation_no_overlap": fp,
            "paragraph_with_overlap": fn,
            "paragraph_no_overlap": [r for r in paragraph if r["scripture_ngrams"] == 0],
        }
        sample = []
        for name, pool in strata.items():
            picked = rng.sample(pool, min(SAMPLE_PER_STRATUM, len(pool)))
            for rec in picked:
                sample.append({**rec, "stratum": name, "verdict": ""})
            print(f"  stratum {name:<26} pool={len(pool):>6}  sampled={len(picked)}")
        Path(args.sample_out).write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in sample) + "\n",
            encoding="utf-8",
        )
        print(f"\nstratified sample for hand-checking -> {args.sample_out} ({len(sample)} blocks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
