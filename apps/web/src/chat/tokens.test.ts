import { describe, expect, it } from "vitest";

import { estimateTokens } from "./tokens";
import type { SourceKind } from "./types";

describe("estimateTokens", () => {
  it("estimates more tokens for dense kinds than prose at the same length", () => {
    const text = "G3439 abbreviation-heavy Strong's-style text.";
    expect(estimateTokens(text, "lexicon")).toBeGreaterThan(estimateTokens(text, "bible"));
  });

  it("treats xref as a dense kind, same as lexicon", () => {
    const text = "John 3:16 cross-references: Rom.5.8, 1John.4.9-10.";
    expect(estimateTokens(text, "xref")).toBe(estimateTokens(text, "lexicon"));
  });

  it("estimates more tokens for non-ASCII (Cyrillic) than ASCII of the same length", () => {
    const en = "Explain what only begotten means in John 3 16.";
    const bg = "Какво означава думата единороден в Йоан 3 916.";
    expect(en.length).toBe(bg.length);
    expect(estimateTokens(bg, "bible")).toBeGreaterThan(estimateTokens(en, "bible"));
  });

  it("never under-counts an empty string", () => {
    expect(estimateTokens("", "bible")).toBe(0);
  });
});

// Ties tokens.ts directly to the M9.0b-1 measurement (plan/chat/m9.0-findings.md §5a,
// plan/chat/bench/results-2026-07-30*.json): the estimate must never fall below the real
// usage.prompt_tokens OpenRouter reported, for any sample against any of the four
// calibrated tokenizer families. This is the property MULTIPLIER exists to guarantee,
// and the one that broke at the old, unmeasured 1.15.
//
// Both arrays below are copied verbatim from the checked-in bench artifacts, not
// hand-written, so this stays a real regression test rather than a tautology. They are
// embedded rather than read from disk because apps/web has no @types/node / fs access —
// its tests run against browser-shaped globals only (tsconfig.json `include: ["src"]`).
// Re-copy both if the corpus or the measurement is ever redone.

// id, kind (bench corpus label, see plan/chat/bench/prompts.jsonl), text
const PROMPTS: readonly [string, string, string][] = [
  ["en-bible", "bible", "16 For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life. 17 For God didn’t send his Son into the world to judge the world, but that the world should be saved"],
  ["en-commentary", "commentary", "We found, in the close of the foregoing chapter, that few were brought to Christ at Jerusalem; yet here was one, a considerable one. It is worth while to go a great way for the salvation though but of one soul. Observe, I. Who this"],
  ["en-lexicon", "lexicon", "Thin cakes (Ex. 16:31; 29:2, 23; Lev. 2:4; 7:12; 8:26; Num. 6:15, 19) used in various offerings."],
  ["bg-question", "question", "Какво означава думата „единороден“ в Йоан 3:16 и защо различните български преводи я предават по различен начин в този стих?"],
  ["bg-plus-en", "question", "Explain what \"only begotten\" means in John 3:16 — какво точно казва гръцкият текст и как да го преведа на български?"],
  ["bg-long", "question", "Обясни ми разликата между оправданието и освещението според Писанието, като посочиш кои стихове говорят за всяко от тях, защо богословите ги разграничават толкова внимателно и какво следва от това разграничение за живота на вярващия."],
  ["en-strongs", "lexicon", "G3439 μονογενής (monogenes, mon-og-en-ace'): from 3441 and 1096; only-born, i.e. sole:--only (begotten, child). see GREEK for 3441 see GREEK for 1096"],
  ["en-commentary-2", "commentary", "From three very comfortable premises David, in this psalm, draws three very comfortable conclusions, and teaches us to do so too. We are saved by hope, and that hope will not make us ashamed, because it is well grounded. It is the duty of"],
  ["en-xref", "xref", "John 3:16 cross-references: 1John.4.9-10,19; 1Tim.1.15-16; 2Cor.5.19-21; Gen.22.12; John.1.14,18; John.3.15; Luke.2.14; Mark.12.6; Matt.9.13; Rom.5.10; Rom.5.8; Rom.8.32; Titus.3.4"],
  ["bg-prose", "prose", "Бог, Който не трябва да бъде разделян по природа и битие, но се различава по няколко особени относителни свойства и лични отношения; което учение за Троицата е основата на цялото ни общение с Бога и на утешителното ни упование в Него."],
];

// id, family, actual usage.prompt_tokens (raw, unadjusted — the conservative figure the
// estimate must clear, since it includes the same chat-template overhead a real request
// does).
const MEASURED: readonly [string, string, number][] = [
  ["bg-long", "cohere", 79],
  ["bg-long", "gemini", 69],
  ["bg-long", "llama-nemotron", 90],
  ["bg-long", "qwen", 105],
  ["bg-plus-en", "cohere", 39],
  ["bg-plus-en", "gemini", 37],
  ["bg-plus-en", "llama-nemotron", 54],
  ["bg-plus-en", "qwen", 57],
  ["bg-prose", "cohere", 83],
  ["bg-prose", "gemini", 68],
  ["bg-prose", "llama-nemotron", 85],
  ["bg-prose", "qwen", 104],
  ["bg-question", "cohere", 46],
  ["bg-question", "gemini", 41],
  ["bg-question", "llama-nemotron", 56],
  ["bg-question", "qwen", 69],
  ["en-bible", "cohere", 54],
  ["en-bible", "gemini", 57],
  ["en-bible", "llama-nemotron", 73],
  ["en-bible", "qwen", 68],
  ["en-commentary", "cohere", 53],
  ["en-commentary", "gemini", 53],
  ["en-commentary", "llama-nemotron", 69],
  ["en-commentary", "qwen", 66],
  ["en-commentary-2", "cohere", 51],
  ["en-commentary-2", "gemini", 51],
  ["en-commentary-2", "llama-nemotron", 68],
  ["en-commentary-2", "qwen", 64],
  ["en-lexicon", "cohere", 50],
  ["en-lexicon", "gemini", 58],
  ["en-lexicon", "llama-nemotron", 75],
  ["en-lexicon", "qwen", 70],
  ["en-strongs", "cohere", 57],
  ["en-strongs", "gemini", 72],
  ["en-strongs", "llama-nemotron", 86],
  ["en-strongs", "qwen", 87],
  ["en-xref", "cohere", 102],
  ["en-xref", "gemini", 119],
  ["en-xref", "llama-nemotron", 135],
  ["en-xref", "qwen", 132],
];

describe("estimateTokens vs the M9.0b-1 real measurement", () => {
  const kindById = new Map(PROMPTS.map(([id, kind]) => [id, kind]));
  const textById = new Map(PROMPTS.map(([id, , text]) => [id, text]));

  // The bench corpus's "kind" labels describe sample content, not the app's SourceKind
  // enum (e.g. "question" is the user's own free-text, not a StudySource). Map to any
  // SourceKind that lands in the same divisor band: dense for lexicon/xref, prose
  // otherwise. Which exact non-dense kind is used does not matter to the estimator.
  const sourceKindByBenchKind: Record<string, SourceKind> = {
    bible: "bible",
    commentary: "commentary",
    lexicon: "lexicon",
    xref: "xref",
    question: "note",
    prose: "book",
  };

  it("covers all ten prompts across all four calibrated families", () => {
    expect(MEASURED.length).toBe(40);
    expect(new Set(MEASURED.map(([, family]) => family)).size).toBe(4);
  });

  it.each(MEASURED)("%s / %s: estimate >= actual prompt_tokens", (id, _family, actual) => {
    const text = textById.get(id);
    const benchKind = kindById.get(id);
    if (!text || !benchKind) throw new Error(`no prompt fixture for sample ${id}`);
    const kind = sourceKindByBenchKind[benchKind];
    if (!kind) throw new Error(`no SourceKind mapping for bench kind ${benchKind}`);
    expect(estimateTokens(text, kind)).toBeGreaterThanOrEqual(actual);
  });
});
