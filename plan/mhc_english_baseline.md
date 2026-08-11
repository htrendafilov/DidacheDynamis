# MHC English corpus baseline — after M1 repair

**Measured 2026-08-11 against `data/sources/MHC.imp.gz` (CrossWire MHC 2.2) with the repaired
importer.** Regenerate the heuristic figures with `scripts/mhc_quotation_audit.py`; the tables below
come from `load_sword_commentary` directly. **Every budget in the master plan derives from the
corpus total restated here, not from the pre-repair numbers.**

## What changed

The pre-M1 import shipped **48 of 66 books and 3,479 of 5,506 keys** while reporting `result: ok`
with no warnings. Two independent causes: unmatched Roman-numeral book names (18 books, 1,039
keys), and chapter introductions keyed `Book N:0` discarded by a `chapter < 1 or verse < 1` guard.

| | Before M1 | After M1 |
|---|---|---|
| Books | 48 | **66** |
| Entries | 3,479 | **5,355** |
| — verse entries | 3,479 | 4,249 |
| — chapter introductions | 0 | **1,106** |

## Key accounting

Every raw key lands in exactly one bucket, and the buckets are asserted to sum to the key count.

| Bucket | Keys |
|---|---|
| `imported` | 5,355 |
| `ignored_scaffolding` | 151 |
| `fatal_unmatched` | 0 |
| **total** | **5,506** |

`ignored_scaffolding` is 61 empty `Book 0:0` milestones, 5 carrying only the book's own title, 83
sub-5-word `Book N:0` records, and 2 testament headings. Scaffolding is decided by measuring each
record, never by its key's shape: the corpus holds 151 records under 5 words and 5,355 over 20,
with **nothing in between**, so the threshold sits inside a measured gap. A record landing in that
gap fails the build rather than being classified, because the gap is the threshold's only
justification.

## Corpus totals — the base for every budget

| Metric | Value |
|---|---|
| Entries | 5,355 |
| Blocks | 34,825 |
| Runs | 539,835 |
| **Words** | **7,284,391** |

## The `quotation` heuristic — the number D3 is decided against

`study.py` marks a block `quotation` when any run is superscript, not by detecting Scripture.
Measured against the KJV already in `content.sqlite` — an independent source, not the heuristic's
own signal — using verbatim 8-gram overlap:

| Direction | Result |
|---|---|
| **False positives** | **0.00%** — 0 of 4,253 quotation blocks lack verbatim KJV overlap |
| Superscript shapes | **100% numeric** — all 29,173 are verse numbers; no other kind exists |
| **Paragraph blocks containing verbatim Scripture** | **36.47%** — 9,897 of 27,135 |
| Share of paragraph *words* inside such spans | **at most 1.80%** — 114,719 of 6,361,571 |

**The two directions are not symmetric, and the asymmetry is the finding.**

The label is *precise*. Every block it marks is genuinely quoted Scripture, and the only
superscripts in the corpus are verse numbers, so "contains a superscript" and "contains a verse
number" are the same predicate here. There is no false-positive problem to design around.

It is not *complete*, and the incompleteness is structural rather than an error rate. Henry quotes
Scripture inline constantly — *"he looked up to the window … and cried, Who is on my side? Who? v.
32"* — and an inline quotation carries no verse-number superscript, so it stays `paragraph`. That
is 36% of paragraph blocks but only about 1.8% of paragraph words: these are commentary blocks
containing a quoted clause, not quotations in disguise.

**Consequence for D3.** Treating the `quotation` label as the Scripture-handling boundary covers
block-quoted Scripture completely and inline Scripture not at all. A policy written only for the
label leaves roughly 115,000 words of verbatim Scripture to be translated under paragraph rules —
precisely the failure the master plan flags, arriving through a gap rather than through a
misclassification. D3 and the §8.3 QA checks must say what happens to inline quotations. The
`runs[].ref` targets already in the CIR are the obvious handle: paragraph blocks carry 74.8% of
them against quotation blocks' 0.9%.

## Per-book

| Book | Verse entries | Introductions | Blocks | Runs | Words |
|---|---|---|---|---|---|
| Gen | 239 | 49 | 1,483 | 17,568 | 279,684 |
| Exod | 136 | 39 | 823 | 12,684 | 178,950 |
| Lev | 88 | 26 | 455 | 8,796 | 115,285 |
| Num | 107 | 35 | 660 | 11,154 | 160,885 |
| Deut | 101 | 33 | 727 | 11,465 | 164,516 |
| Josh | 74 | 23 | 524 | 7,444 | 122,525 |
| Judg | 72 | 20 | 540 | 7,826 | 133,102 |
| Ruth | 12 | 3 | 102 | 1,392 | 24,058 |
| 1Sam | 102 | 30 | 772 | 10,781 | 173,781 |
| 2Sam | 76 | 23 | 581 | 8,171 | 130,955 |
| 1Kgs | 74 | 21 | 579 | 9,144 | 130,425 |
| 2Kgs | 82 | 24 | 575 | 8,113 | 130,291 |
| 1Chr | 66 | 28 | 372 | 6,666 | 73,760 |
| 2Chr | 83 | 35 | 540 | 8,221 | 110,596 |
| Ezra | 26 | 9 | 193 | 2,817 | 38,086 |
| Neh | 32 | 12 | 256 | 3,879 | 52,594 |
| Esth | 21 | 9 | 167 | 2,088 | 32,622 |
| Job | 134 | 41 | 1,096 | 17,655 | 255,919 |
| Ps | 445 | 149 | 3,016 | 43,857 | 595,536 |
| Prov | 536 | 11 | 1,469 | 15,082 | 194,859 |
| Eccl | 42 | 11 | 360 | 6,377 | 79,628 |
| Song | 26 | 7 | 212 | 5,325 | 52,217 |
| Isa | 192 | 65 | 1,763 | 29,164 | 418,786 |
| Jer | 148 | 51 | 1,140 | 24,827 | 319,420 |
| Lam | 14 | 4 | 126 | 3,402 | 35,734 |
| Ezek | 133 | 47 | 979 | 24,271 | 276,317 |
| Dan | 40 | 11 | 346 | 8,160 | 103,389 |
| Hos | 33 | 13 | 346 | 7,745 | 89,480 |
| Joel | 10 | 2 | 87 | 2,036 | 22,253 |
| Amos | 21 | 8 | 190 | 3,826 | 47,381 |
| Obad | 3 | 1 | 29 | 623 | 7,710 |
| Jonah | 9 | 3 | 89 | 1,548 | 26,102 |
| Mic | 17 | 6 | 136 | 3,049 | 38,236 |
| Nah | 7 | 2 | 47 | 1,005 | 12,552 |
| Hab | 9 | 2 | 76 | 1,699 | 20,278 |
| Zeph | 10 | 2 | 73 | 1,434 | 17,187 |
| Hag | 5 | 1 | 42 | 851 | 12,311 |
| Zech | 34 | 13 | 292 | 6,372 | 78,385 |
| Mal | 9 | 3 | 109 | 2,561 | 32,742 |
| Matt | 131 | 27 | 3,190 | 39,519 | 470,570 |
| Mark | 69 | 15 | 824 | 14,044 | 126,811 |
| Luke | 109 | 23 | 1,547 | 30,264 | 283,385 |
| John | 96 | 20 | 2,280 | 37,878 | 407,080 |
| Acts | 109 | 27 | 1,564 | 22,752 | 379,179 |
| Rom | 48 | 15 | 602 | 8,940 | 140,646 |
| 1Cor | 67 | 15 | 450 | 5,082 | 102,910 |
| 2Cor | 38 | 12 | 249 | 2,751 | 40,910 |
| Gal | 18 | 5 | 150 | 1,708 | 39,422 |
| Eph | 18 | 5 | 116 | 2,058 | 38,210 |
| Phil | 19 | 3 | 131 | 1,881 | 26,195 |
| Col | 17 | 3 | 123 | 1,803 | 22,954 |
| 1Thess | 18 | 4 | 133 | 1,126 | 21,963 |
| 2Thess | 9 | 2 | 79 | 468 | 11,170 |
| 1Tim | 17 | 5 | 133 | 1,515 | 26,517 |
| 2Tim | 13 | 3 | 110 | 1,255 | 20,614 |
| Titus | 8 | 2 | 109 | 1,615 | 25,318 |
| Phlm | 2 | 0 | 46 | 599 | 10,085 |
| Heb | 33 | 12 | 487 | 3,253 | 79,906 |
| Jas | 13 | 4 | 122 | 1,673 | 36,470 |
| 1Pet | 22 | 4 | 213 | 1,972 | 34,756 |
| 2Pet | 13 | 2 | 86 | 1,076 | 22,314 |
| 1John | 26 | 4 | 186 | 2,709 | 40,429 |
| 2John | 5 | 1 | 31 | 233 | 4,220 |
| 3John | 4 | 0 | 28 | 204 | 3,192 |
| Jude | 4 | 0 | 43 | 635 | 11,229 |
| Rev | 55 | 21 | 421 | 3,744 | 69,399 |
