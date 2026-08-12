# MHC English corpus baseline — after M1 repair

**Measured 2026-08-11 against `data/sources/MHC.imp.gz` (CrossWire MHC 2.2; committed export SHA-256
`3238c932ece1ced9c4f824e6a293e3caf5c528cd369e4d3cbdeb41e089af61e0`) with the repaired importer.**
Regenerate the heuristic figures with `scripts/mhc_quotation_audit.py`; the tables below come from
`load_sword_commentary` directly. **Every budget in the master plan derives from the corpus total
restated here, not from the pre-repair numbers.**

## M1 status — done, and how that is checked

**M1 is complete.** "Complete" here means each clause of its exit gate is asserted by a test that
runs in `scripts/check.sh` and CI, not that someone read the code and agreed. A gate that is only
prose drifts; a gate that is a test fails loudly when it stops holding.

| Exit-gate clause | Asserted by |
|---|---|
| the accounting equation balances against the 5,506 raw keys | `test_the_real_corpus_accounting_balances` |
| per-book counts match the source they were measured from | `test_per_book_counts_match_the_checksummed_source_exactly` (pins the export SHA-256 and the complete 66-book map, in canonical order taken from the imported rows) |
| every ignored record is provably not content | `test_an_empty_unplaceable_record_is_scaffolding_not_fatal`, `test_a_book_milestone_saying_only_the_title_is_scaffolding`, `test_visible_text_does_not_mistake_cdata_for_markup` |
| no record carrying content can be ignored | `test_short_commentary_at_a_real_coordinate_is_never_scaffolding`, `test_a_book_milestone_saying_more_than_the_title_is_fatal`, `test_visible_text_that_produces_no_cir_is_fatal`, `test_cdata_content_is_never_silently_dropped`, `test_a_record_carrying_prose_that_cannot_be_placed_is_fatal` |
| chapter introductions are readable in the app | `test_search_finds_a_chapter_introduction_without_inventing_a_verse` (API), `SearchPanel.test.tsx` "labels a commentary hit inside a chapter introduction", `context.test.ts` "includes a chapter introduction for any verse" |
| diagnostics cannot report success after dropping real content | `test_append_study_content_refuses_to_build_when_a_key_is_unclassifiable`, `test_add_study_and_build_all_publish_the_same_mhc_statistics` |

**One deliberate deviation from the gate's wording.** It says *"every ignored record is provably
empty"*. Five of the 66 `Book 0:0` milestones are not empty — they carry the book's own name
("Obadiah", "Second John"). They are ignored on a stricter test than emptiness: the text must match
that book's name exactly, ordinals included. A milestone saying anything else is fatal. Treating
them as empty would have required either failing the build on five known-harmless records or
loosening the rule by length, and length is what let `"Jesus wept."` disappear.

**What M1 does not establish.** The hand-check of the quotation strata below was done by the
implementer, not the owner. D3 rests on it and should not be frozen on this alone.

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

**Classification is structural, not length-based.** Whether a record *can* be scaffolding is
decided by its coordinates; only then is its content measured:

* a record at a real coordinate (`chapter ≥ 1`) is content **however short** — an earlier draft
  used a global under-5-words rule, which silently discarded `"Jesus wept."` at John 11:35 and so
  recreated the exact failure M1 exists to eliminate;
* an empty record at a real coordinate is an empty introduction slot — 83 of them, nothing to
  import and nothing lost;
* a `Book 0:0` record has no chapter for content to attach to and can never become an entry: 61
  are empty, 5 carry only the book's own title. One carrying more than a title is **fatal**, because
  that would mean the source has book-level introductions this loader does not handle;
* a key with no resolvable coordinate at all (2 testament headings) is ignorable only when empty;
  carrying text, it is fatal.

## Corpus totals — the base for every budget

| Metric | Value |
|---|---|
| Entries | 5,355 |
| Blocks | 34,825 |
| Runs | 539,835 |
| Words | 7,284,391 |
| Characters | 38,956,398 |
| **Tokens (English prose)** | **8,894,155 – 9,571,597** |

Tokens are a band, not a point: `plan/chat/m9.0-findings.md` §5 measured 4.07–4.38 chars/token for
English prose across Gemini, Llama/Nemotron, Qwen and Cohere. Quoting one number would imply a
precision no tokenizer-free estimate has. Budgets should use the **upper** bound.

## The `quotation` heuristic — the number D3 is decided against

`study.py` marks a block `quotation` when any run is superscript, not by detecting Scripture.
Measured against the KJV already in `content.sqlite` — an independent source, not the heuristic's
own signal — using verbatim n-gram overlap.

| Direction | Result |
|---|---|
| **False positives** | **0.00%** — 0 of 4,253 quotation blocks lack verbatim KJV overlap |
| Superscript shapes | **100% numeric** — all 29,173 are verse numbers; no other kind exists |
| **Paragraph blocks containing verbatim Scripture** (n=8) | **36.47%** — 9,897 of 27,135 |
| Share of paragraph *words* inside matched spans (n=8) | **2.49%** — 158,606 of 6,361,571 |

Word coverage counts the **union of matched token positions**. An earlier draft estimated it as
`unique_ngrams + 7`, which assumes every match forms one contiguous span and undercounted a block
quoting two separate verses: it reported 1.80% where the true figure for the same matches is 2.49%.

### Sensitivity — the detection threshold is a floor, not a measurement

Shorter n catches looser quotation and more noise; longer n is conservative. The affected share is
a band:

| n | Paragraph blocks | Paragraph words |
|---|---|---|
| 5 | 78.27% | 9.22% |
| 6 | 62.19% | 5.38% |
| **8** | **36.47%** | **2.49%** |
| 10 | 18.42% | 1.22% |

n=8 is the reported figure: long enough that ordinary English does not collide with a verse by
chance, short enough to catch a quoted clause. **All of these are lower bounds** — a quotation
shorter than n is invisible, and hand-checking found exactly that: at John 19:19 Henry writes
*"What I have written I have written"*, a seven-word quotation of John 19:22, undetected at n=8.

### Hand-check

`scripts/mhc_quotation_audit.py --sample-out` draws **60 blocks from each of four strata**,
including the two the automated signals call correct — an earlier draft sampled only suspected
errors, so with zero detected false positives it produced no quotation blocks at all and nothing
about the label itself was reviewable.

Reviewed by the implementer, not the owner; D3 should not be frozen on this alone:

| Stratum | Pool | Sampled | Finding |
|---|---|---|---|
| `quotation_with_overlap` | 4,253 | 60 | every block opens with a verse-number superscript and is verbatim Scripture; no non-Scripture block found |
| `quotation_no_overlap` | 0 | 0 | empty — the label has no undetected-quotation stratum |
| `paragraph_with_overlap` | 9,897 | 60 | commentary prose containing quoted clauses, not quotations mislabelled |
| `paragraph_no_overlap` | 17,238 | 60 | commentary prose; at least one carries a sub-n quotation, confirming the floor |

**The two directions are not symmetric, and the asymmetry is the finding.**

The label is *precise*. Every block it marks is genuinely quoted Scripture, and the only
superscripts in the corpus are verse numbers, so "contains a superscript" and "contains a verse
number" are the same predicate here. There is no false-positive problem to design around.

It is not *complete*, and the incompleteness is structural rather than an error rate. Henry quotes
Scripture inline constantly, and an inline quotation carries no verse-number superscript, so it
stays `paragraph`.

**Consequence for D3.** Treating the `quotation` label as the Scripture-handling boundary covers
block-quoted Scripture completely and inline Scripture not at all — at least 158,606 words of
verbatim Scripture, and plausibly several times that once sub-8-word and modernised quotations are
counted. D3 and the §8.3 QA checks must say what happens to inline quotations. The `runs[].ref`
targets already in the CIR are the obvious handle: paragraph blocks carry 74.8% of them against
quotation blocks' 0.9%.

## Per-book

Token ranges use the same 4.07–4.38 chars/token band.

| Book | Verse entries | Introductions | Blocks | Runs | Words | Tokens |
|---|---|---|---|---|---|---|
| Gen | 239 | 49 | 1,483 | 17,568 | 279,684 | 340,183–366,094 |
| Exod | 136 | 39 | 823 | 12,684 | 178,950 | 217,950–234,550 |
| Lev | 88 | 26 | 455 | 8,796 | 115,285 | 140,206–150,885 |
| Num | 107 | 35 | 660 | 11,154 | 160,885 | 197,566–212,614 |
| Deut | 101 | 33 | 727 | 11,465 | 164,516 | 199,878–215,102 |
| Josh | 74 | 23 | 524 | 7,444 | 122,525 | 150,189–161,629 |
| Judg | 72 | 20 | 540 | 7,826 | 133,102 | 162,917–175,326 |
| Ruth | 12 | 3 | 102 | 1,392 | 24,058 | 28,918–31,121 |
| 1Sam | 102 | 30 | 772 | 10,781 | 173,781 | 210,306–226,325 |
| 2Sam | 76 | 23 | 581 | 8,171 | 130,955 | 158,413–170,479 |
| 1Kgs | 74 | 21 | 579 | 9,144 | 130,425 | 158,375–170,438 |
| 2Kgs | 82 | 24 | 575 | 8,113 | 130,291 | 157,544–169,543 |
| 1Chr | 66 | 28 | 372 | 6,666 | 73,760 | 90,001–96,856 |
| 2Chr | 83 | 35 | 540 | 8,221 | 110,596 | 134,739–145,002 |
| Ezra | 26 | 9 | 193 | 2,817 | 38,086 | 46,707–50,265 |
| Neh | 32 | 12 | 256 | 3,879 | 52,594 | 64,715–69,644 |
| Esth | 21 | 9 | 167 | 2,088 | 32,622 | 39,939–42,981 |
| Job | 134 | 41 | 1,096 | 17,655 | 255,919 | 308,780–332,299 |
| Ps | 445 | 149 | 3,016 | 43,857 | 595,536 | 719,860–774,690 |
| Prov | 536 | 11 | 1,469 | 15,082 | 194,859 | 236,803–254,839 |
| Eccl | 42 | 11 | 360 | 6,377 | 79,628 | 95,522–102,797 |
| Song | 26 | 7 | 212 | 5,325 | 52,217 | 63,466–68,300 |
| Isa | 192 | 65 | 1,763 | 29,164 | 418,786 | 511,273–550,215 |
| Jer | 148 | 51 | 1,140 | 24,827 | 319,420 | 389,415–419,076 |
| Lam | 14 | 4 | 126 | 3,402 | 35,734 | 43,496–46,809 |
| Ezek | 133 | 47 | 979 | 24,271 | 276,317 | 336,279–361,893 |
| Dan | 40 | 11 | 346 | 8,160 | 103,389 | 126,887–136,552 |
| Hos | 33 | 13 | 346 | 7,745 | 89,480 | 109,123–117,434 |
| Joel | 10 | 2 | 87 | 2,036 | 22,253 | 27,189–29,260 |
| Amos | 21 | 8 | 190 | 3,826 | 47,381 | 57,862–62,269 |
| Obad | 3 | 1 | 29 | 623 | 7,710 | 9,540–10,267 |
| Jonah | 9 | 3 | 89 | 1,548 | 26,102 | 31,167–33,541 |
| Mic | 17 | 6 | 136 | 3,049 | 38,236 | 46,488–50,029 |
| Nah | 7 | 2 | 47 | 1,005 | 12,552 | 15,524–16,707 |
| Hab | 9 | 2 | 76 | 1,699 | 20,278 | 24,664–26,543 |
| Zeph | 10 | 2 | 73 | 1,434 | 17,187 | 21,133–22,743 |
| Hag | 5 | 1 | 42 | 851 | 12,311 | 14,794–15,921 |
| Zech | 34 | 13 | 292 | 6,372 | 78,385 | 95,590–102,871 |
| Mal | 9 | 3 | 109 | 2,561 | 32,742 | 39,945–42,987 |
| Matt | 131 | 27 | 3,190 | 39,519 | 470,570 | 577,984–622,008 |
| Mark | 69 | 15 | 824 | 14,044 | 126,811 | 154,211–165,957 |
| Luke | 109 | 23 | 1,547 | 30,264 | 283,385 | 344,447–370,683 |
| John | 96 | 20 | 2,280 | 37,878 | 407,080 | 497,682–535,589 |
| Acts | 109 | 27 | 1,564 | 22,752 | 379,179 | 465,691–501,162 |
| Rom | 48 | 15 | 602 | 8,940 | 140,646 | 174,271–187,545 |
| 1Cor | 67 | 15 | 450 | 5,082 | 102,910 | 128,400–138,180 |
| 2Cor | 38 | 12 | 249 | 2,751 | 40,910 | 50,693–54,555 |
| Gal | 18 | 5 | 150 | 1,708 | 39,422 | 48,778–52,493 |
| Eph | 18 | 5 | 116 | 2,058 | 38,210 | 48,002–51,658 |
| Phil | 19 | 3 | 131 | 1,881 | 26,195 | 32,094–34,538 |
| Col | 17 | 3 | 123 | 1,803 | 22,954 | 28,150–30,294 |
| 1Thess | 18 | 4 | 133 | 1,126 | 21,963 | 27,442–29,532 |
| 2Thess | 9 | 2 | 79 | 468 | 11,170 | 13,909–14,968 |
| 1Tim | 17 | 5 | 133 | 1,515 | 26,517 | 32,978–35,490 |
| 2Tim | 13 | 3 | 110 | 1,255 | 20,614 | 25,403–27,338 |
| Titus | 8 | 2 | 109 | 1,615 | 25,318 | 32,277–34,736 |
| Phlm | 2 | 0 | 46 | 599 | 10,085 | 12,584–13,543 |
| Heb | 33 | 12 | 487 | 3,253 | 79,906 | 99,431–107,005 |
| Jas | 13 | 4 | 122 | 1,673 | 36,470 | 44,916–48,337 |
| 1Pet | 22 | 4 | 213 | 1,972 | 34,756 | 44,551–47,944 |
| 2Pet | 13 | 2 | 86 | 1,076 | 22,314 | 27,780–29,896 |
| 1John | 26 | 4 | 186 | 2,709 | 40,429 | 49,995–53,803 |
| 2John | 5 | 1 | 31 | 233 | 4,220 | 5,316–5,720 |
| 3John | 4 | 0 | 28 | 204 | 3,192 | 4,113–4,427 |
| Jude | 4 | 0 | 43 | 635 | 11,229 | 14,299–15,388 |
| Rev | 55 | 21 | 421 | 3,744 | 69,399 | 85,412–91,917 |
