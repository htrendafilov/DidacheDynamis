# M9.0b-1 benchmark corpus

Work order: [`../m9.0b-1-estimator-calibration.md`](../m9.0b-1-estimator-calibration.md)

Ten sanitized prompts used to calibrate the token estimator that guards the
§8.3 context budget, and later reused by
[`../m9.0b-2-bulgarian-quality.md`](../m9.0b-2-bulgarian-quality.md) for answer
scoring. Build the corpus once; both halves read the same file.

## Files

| File | What it is |
|---|---|
| `prompts.jsonl` | The corpus. One JSON object per line. Generated — do not hand-edit. |
| `results-<date>.json` | Raw `usage.prompt_tokens` per (sample × tokenizer family). |

## Licensing — why there is no Bulgarian scripture here

Every sample comes from a work whose `ai_context_policy` is `allowed`:

| Sample | Source | Licence |
|---|---|---|
| 1 | WEB John 3:16-18 | Public domain |
| 2, 8 | Matthew Henry | Public domain (CrossWire) |
| 3 | Easton's Bible Dictionary | Public domain (CrossWire) |
| 4, 5, 6 | Composed user questions | Written for this corpus |
| 7 | Strong's Greek G3439 | Public domain (CrossWire) |
| 9 | TSK cross-references | Public domain (CrossWire) |
| 10 | Bulgarian 1689 Confession | **CC0 1.0** |

**No Bulgarian Bible text, ever.** `../../content_and_licensing.md` records no
cleared open Bulgarian Bible, and any future one arrives under a negotiated,
non-open licence — `allowed_no_training` at best — whose text must never reach
an external AI service, let alone a public repository. Sample 10 uses the CC0
Bulgarian 1689 Confession instead: formal theological prose in the same
register, already cleared. See the work order §1a.

`bench_build_corpus.py` asserts every contributing work is `allowed` before it
writes anything, so a content rebuild cannot quietly change this.

## Rebuilding the corpus

```bash
python3 scripts/bench_build_corpus.py
```

Deterministic — same `data/content.sqlite` in, same corpus out. Re-run after a
content rebuild to confirm the samples still resolve. It needs
`data/content.sqlite` at schema v4 and
`data/sources/BaptistConfession1689_BG.imp`.

Three extraction details that matter, all of which silently corrupted the first
attempt:

- **A CIR block carries both `text` and `runs` holding the same content.**
  Concatenating both doubles every sample. Prefer `runs`.
- **Matthew Henry blocks open with the quoted scripture** as a `quotation`
  block. Commentary samples filter to `paragraph`, or they measure Bible text.
- **Sample 3 must be genuinely dense.** It is the sole justification for the
  `dense` divisors (2.15 chars/token, ~2× denser than prose). Clipping 86
  characters off a long prose entry yields prose density and destroys the
  sample, so the builder picks the densest *short* Easton's entry —
  reference-and-abbreviation soup.

## Running the measurement

```bash
export OPENROUTER_API_KEY=sk-or-...      # dedicated, spend-limited
python3 scripts/bench_measure_tokens.py
```

Cost is 10 prompts × 4 models × 1 output token — cents at most. **Revoke the
key afterwards** (work order DoD).

Override the pins if a model has retired, and record the substitution here:

```bash
python3 scripts/bench_measure_tokens.py --models gemini=google/gemini-2.5-flash-lite,cohere=cohere/north-mini-code
```

### Why two ratios are reported

`usage.prompt_tokens` includes chat-template overhead — role markers and
control tokens that are not part of the sample. The harness measures that
overhead once per model with a one-character message and reports both:

- **raw** (`chars_per_token`) — conservative, includes overhead. This is the
  number the divisor must satisfy, because the estimator has to cover the whole
  request.
- **adjusted** (`chars_per_token_adjusted`) — overhead subtracted. This is the
  number that compares tokenizer *families* fairly, since overhead differs per
  model and would otherwise be mistaken for a tokenization difference.

### Exit criterion

**The estimate must never be below actual on any sample.** The harness prints
`UNDER-COUNT` per offending row and the multiplier each would require. If any
appear, raise the multiplier in `apps/web/src/chat/tokens.ts` to the largest
required value and record the measurement in
[`../m9.0-findings.md`](../m9.0-findings.md) §5.

## Model pins

One per tokenizer family; family coverage is the point, not model count. The
shipped divisors were calibrated on two Gemini models with an **unmeasured**
×1.15 covering everything else — while `openrouter/free` demonstrably routes to
Cohere and NVIDIA models (`../m9.0-findings.md` §9).

| Family | Pin |
|---|---|
| Gemini | `google/gemini-2.5-flash-lite` |
| Llama / Nemotron | `nvidia/nemotron-3-super-120b-a12b` |
| Cohere | `cohere/north-mini-code` |
| Qwen | `qwen/qwen3-30b-a3b` |

If a family cannot be measured, the fallback is work-order §3: constrain the
model picker to measured families. That costs `openrouter/free` — a dynamic
router cannot promise a family — which is a smaller loss than it sounds, since
no default model ships and the user picks explicitly anyway.
