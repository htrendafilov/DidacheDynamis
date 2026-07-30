// CIR -> plain text, for putting reader content into a chat prompt (M9.3 step 2).
// Content arrives as CIR (Passage/Document/StrongEntry/CrossReferences), not text; without
// this module nothing can be normalized into a prompt. Never emits HTML.
import type {
  CrossReferences,
  Document,
  DocumentBlock,
  Line,
  Passage,
  StrongEntry,
  Verse,
} from "../data/api";

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
}

// "16" -> {16}; "16-18" -> {16,17,18}. Malformed input matches nothing, which is the
// safe direction: better to drop a verse than to silently include an unrequested one.
function parseVerseRange(verses: string): Set<number> | null {
  const single = /^(\d+)$/.exec(verses);
  if (single) return new Set([Number(single[1])]);
  const range = /^(\d+)-(\d+)$/.exec(verses);
  if (!range) return null;
  const [start, end] = [Number(range[1]), Number(range[2])];
  if (end < start) return null;
  const set = new Set<number>();
  for (let n = start; n <= end; n++) set.add(n);
  return set;
}

function lineText(line: Line): string {
  return line.runs.map((run) => run.t).join("");
}

// Poetry (kind "q") keeps its line break; prose lines within one verse concatenate as
// continuous text. `level` (indent depth) is presentation only and is dropped.
function verseText(v: Verse): string {
  let out = "";
  v.lines.forEach((line, i) => {
    const text = lineText(line);
    if (i === 0) {
      out = text;
      return;
    }
    const prev = v.lines[i - 1];
    const sep = line.kind === "q" || prev.kind === "q" ? "\n" : " ";
    out += sep + text;
  });
  return collapseWhitespace(`${v.verse} ${out}`);
}

export function passageToText(p: Passage, verses?: string): string {
  const wanted = verses ? parseVerseRange(verses) : null;
  const included = wanted ? p.verses.filter((v) => wanted.has(v.verse)) : p.verses;
  return included.map(verseText).join("\n");
}

function blockText(block: DocumentBlock): string {
  // DocumentRenderer.tsx mirrors this exactly: block.runs, when present, is the
  // authoritative content and block.text is only a fallback for when it is absent.
  // ref / dictionary_ref link targets are dropped by simply never reading them here;
  // their visible text (run.t) is kept. emphasis/strong/superscript are presentation.
  const raw = block.runs ? block.runs.map((run) => run.t).join("") : block.text;
  return collapseWhitespace(raw);
}

export function documentToText(d: Document): string {
  const parts: string[] = [];
  for (const block of d.blocks) {
    const text = blockText(block);
    if (!text) continue;
    parts.push(block.kind === "quotation" ? `> ${text}` : text);
  }
  return parts.join("\n\n");
}

export function strongEntryToText(e: StrongEntry): string {
  const gloss = e.transliteration ? `${e.lemma} (${e.transliteration})` : e.lemma;
  const header = e.pronunciation ? `${gloss} [${e.pronunciation}]` : gloss;
  return `${header}\n${collapseWhitespace(e.definition)}`;
}

function referenceLabel(target_osis: string, target_chapter: number, target_ref: string): string {
  // target_ref is OSIS dot notation, e.g. "1John.4.9-10"; the verse part is everything
  // after book.chapter, same slicing BiblePane.tsx already uses for xref display.
  const versePart = target_ref.split(".").slice(2).join(".");
  return `${target_osis} ${target_chapter}:${versePart}`;
}

export function crossReferencesToText(x: CrossReferences): string {
  return x.references
    .map((r) => {
      const label = referenceLabel(r.target_osis, r.target_chapter, r.target_ref);
      return r.preview ? `${label} — ${collapseWhitespace(r.preview)}` : label;
    })
    .join("\n");
}
