// No tokenizer may be bundled (M9.3 step 2, §3). Estimates chars/token by a per-kind
// divisor band, then applies a safety multiplier measured across four tokenizer families.
//
// Divisors measured 2026-07-29 against two Gemini-family tokenizers
// (plan/chat/m9.0-findings.md §5): English prose 4.07-4.38, Bulgarian 3.02-3.25, dense
// symbolic text (Strong's ids, TSK refs, abbreviations) 1.28-2.21 chars/token.
// MULTIPLIER measured 2026-07-30 across Gemini, Llama/Nemotron, Qwen, and Cohere
// (plan/chat/m9.0-findings.md §5a, plan/chat/bench/results-2026-07-30*.json): the worst
// case (a lexicon sample on a Llama/Nemotron pin) needed >=1.540; 1.6 holds with a ~4%
// margin across all 40 (sample x family) measurements, zero under-counts.
import type { SourceKind } from "./types";

const DIVISORS = {
  dense: { ascii: 2.0, other: 2.5 }, // kind === "lexicon" | "xref"
  prose: { ascii: 3.5, other: 2.5 }, // everything else
};
const MULTIPLIER = 1.6;
const DENSE_KINDS: ReadonlySet<SourceKind> = new Set(["lexicon", "xref"]);

function countAscii(text: string): { ascii: number; other: number } {
  let ascii = 0;
  for (const ch of text) if (ch.charCodeAt(0) < 128) ascii++;
  return { ascii, other: [...text].length - ascii };
}

export function estimateTokens(text: string, kind: SourceKind): number {
  const band = DENSE_KINDS.has(kind) ? DIVISORS.dense : DIVISORS.prose;
  const { ascii, other } = countAscii(text);
  const raw = ascii / band.ascii + other / band.other;
  return Math.ceil(raw * MULTIPLIER);
}
