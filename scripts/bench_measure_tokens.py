#!/usr/bin/env python3
"""Measure real prompt_tokens per sample per tokenizer family (M9.0b-1).

Work order: plan/chat/m9.0b-1-estimator-calibration.md

Sends every prompt in plan/chat/bench/prompts.jsonl to each pinned model with
max_tokens=1 and usage accounting on, reads usage.prompt_tokens, and reports
chars/token per (sample x family). Writes plan/chat/bench/results-<date>.json.

    export OPENROUTER_API_KEY=sk-or-...
    python3 scripts/bench_measure_tokens.py

The point is family coverage, not model count: the shipped divisors were
calibrated on two Gemini models and cover Cohere/NVIDIA/Qwen with an
*unmeasured* 1.15 multiplier, while openrouter/free routes to exactly those
families.

Cost: 10 prompts x 4 models x 1 output token. Cents at most. Use a
spend-limited key and revoke it afterwards.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = ROOT / "plan" / "chat" / "bench" / "prompts.jsonl"
URL = "https://openrouter.ai/api/v1/chat/completions"

# One pin per tokenizer family. Substitute freely if a model retires — record
# the substitution in plan/chat/bench/README.md.
DEFAULT_MODELS = {
    "gemini": "google/gemini-2.5-flash-lite",
    "llama-nemotron": "nvidia/nemotron-3-super-120b-a12b",
    "cohere": "cohere/north-mini-code",
    "qwen": "qwen/qwen3-30b-a3b",
}

# Divisors currently proposed for chat/tokens.ts (m9.0-findings.md section 5).
DIVISORS = {"dense": {"ascii": 2.0, "other": 2.5}, "prose": {"ascii": 3.5, "other": 2.5}}
MULTIPLIER = 1.15
DENSE_KINDS = {"lexicon", "xref"}


def estimate(sample: dict) -> int:
    """The shipped heuristic, so measured vs estimated is comparable per sample."""
    band = DIVISORS["dense" if sample["kind"] in DENSE_KINDS else "prose"]
    raw = sample["ascii"] / band["ascii"] + sample["non_ascii"] / band["other"]
    return int(-(-raw * MULTIPLIER // 1))  # ceil


def post(key: str, model: str, content: str, retries: int = 3) -> dict:
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "max_tokens": 1,
            "usage": {"include": True},
            # Suppress reasoning where the model allows it, so thinking tokens
            # cannot land in the accounting (m9.0-findings.md section 8).
            "reasoning": {"enabled": False},
        }
    ).encode()
    request = urllib.request.Request(
        URL,
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://bible.trendafilovi.net",
            "X-Title": "bible_app_bg M9.0b-1 calibration",
        },
    )
    last = ""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}: {exc.read().decode()[:200]}"
            if exc.code in (429, 502, 503):
                time.sleep(4 * (attempt + 1))
                continue
            break
        except Exception as exc:  # noqa: BLE001 - report and keep going
            last = f"{type(exc).__name__}: {exc}"
            time.sleep(3)
    return {"error": last}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", help="family=model,family=model to override the pins")
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        print("set OPENROUTER_API_KEY (use a dedicated, spend-limited key)", file=sys.stderr)
        return 2
    if not PROMPTS.exists():
        print(f"missing {PROMPTS}; run scripts/bench_build_corpus.py", file=sys.stderr)
        return 1

    models = dict(DEFAULT_MODELS)
    if args.models:
        models = dict(pair.split("=", 1) for pair in args.models.split(","))

    samples = [json.loads(line) for line in PROMPTS.read_text(encoding="utf-8").splitlines() if line.strip()]
    results: dict = {
        "date": date.today().isoformat(),
        "divisors": DIVISORS,
        "multiplier": MULTIPLIER,
        "models": models,
        "baseline": {},
        "runs": [],
    }

    # Chat-template overhead: role markers and control tokens are counted in
    # prompt_tokens but are not part of the sample. Measure once per model with
    # a one-character message and report both raw and adjusted ratios — raw is
    # the conservative number the divisor must satisfy, adjusted is the one that
    # compares tokenizers fairly.
    for family, model in models.items():
        response = post(key, model, "x")
        usage = (response or {}).get("usage") or {}
        overhead = usage.get("prompt_tokens")
        results["baseline"][family] = {"model": model, "prompt_tokens": overhead,
                                       "error": response.get("error")}
        print(f"baseline {family:<16} {model:<40} overhead={overhead}")

    for sample in samples:
        for family, model in models.items():
            response = post(key, model, sample["text"])
            usage = (response or {}).get("usage") or {}
            actual = usage.get("prompt_tokens")
            base = (results["baseline"].get(family) or {}).get("prompt_tokens")
            adjusted = (actual - base + 1) if (actual is not None and base is not None) else None
            row = {
                "n": sample["n"],
                "id": sample["id"],
                "kind": sample["kind"],
                "family": family,
                "model": model,
                "reported_model": (response or {}).get("model"),
                "chars": sample["chars"],
                "ascii": sample["ascii"],
                "non_ascii": sample["non_ascii"],
                "prompt_tokens": actual,
                "prompt_tokens_adjusted": adjusted,
                "chars_per_token": round(sample["chars"] / actual, 3) if actual else None,
                "chars_per_token_adjusted": round(sample["chars"] / adjusted, 3) if adjusted else None,
                "estimated_tokens": estimate(sample),
                "error": response.get("error"),
            }
            row["safe"] = (
                row["estimated_tokens"] >= actual if actual is not None else None
            )
            results["runs"].append(row)
            flag = "" if row["safe"] in (True, None) else "  <-- UNDER-COUNT"
            print(
                f"{sample['n']:>2} {sample['id']:<16} {family:<16} "
                f"tok={str(actual):<5} adj={str(adjusted):<5} "
                f"c/t={str(row['chars_per_token_adjusted']):<6} "
                f"est={row['estimated_tokens']:<4}{flag}"
                + (f"  [{row['error']}]" if row["error"] else "")
            )
            time.sleep(0.4)  # stay inside the 20 req/min free-tier limit

    out = args.out or ROOT / "plan" / "chat" / "bench" / f"results-{results['date']}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {out.relative_to(ROOT)}")

    ok = [r for r in results["runs"] if r["prompt_tokens"] is not None]
    under = [r for r in ok if r["safe"] is False]
    print(f"\n{len(ok)}/{len(results['runs'])} runs returned usage")
    if under:
        print(f"UNDER-COUNTS: {len(under)} — the multiplier must be raised:")
        for r in under:
            need = r["prompt_tokens"] / max(r["estimated_tokens"] / MULTIPLIER, 1e-9)
            print(f"  {r['id']} / {r['family']}: est {r['estimated_tokens']} < actual "
                  f"{r['prompt_tokens']} (needs multiplier >= {need:.3f})")
    elif ok:
        worst = min(ok, key=lambda r: r["estimated_tokens"] / r["prompt_tokens"])
        margin = worst["estimated_tokens"] / worst["prompt_tokens"]
        print(f"No under-counts. Tightest margin {margin:.2f}x on "
              f"{worst['id']} / {worst['family']} — multiplier {MULTIPLIER} holds.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
