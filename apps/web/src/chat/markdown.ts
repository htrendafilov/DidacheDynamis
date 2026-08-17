// A very small, safe parser for assistant answers (M9.3 step 5, §8). Paragraphs, headings,
// thematic breaks, unordered/ordered lists, bold, italic, ==highlight==, ++underline++, inline
// code, fenced code, and [S#] citations — nothing else. No raw HTML, no link auto-detection (a
// plain URL in the text is just text). Treat the input as hostile: this only ever produces a data
// tree: ChatMessage.tsx renders it as React elements, never via dangerouslySetInnerHTML, so
// anything this parser does not explicitly recognize (an HTML tag, a javascript: URL, a fake
// system-prompt line) stays inert literal text by construction — there is no code path that
// interprets it.
import { type CitationToken, parseCitations } from "./citations";

export type InlineNode =
  | { type: "text"; text: string }
  // Emphasis carries `children`, not `text`, so markup nests. A flat `text` field was the
  // original shape and it silently swallowed everything inside: "**a ++b++**" rendered the
  // underline markers literally, and — much worse — "*see [S2]*" rendered the citation as plain
  // bracketed text instead of a verifiable chip, because the bold/italic branch of the token
  // alternation consumes the whole span and its contents were never re-parsed.
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  // Emphasis the reader asked for that plain markdown has no syntax for. Deliberately new
  // tokens rather than raw HTML: a <mark> or <u> the model wrote itself would arrive as an
  // HTML tag, which this parser leaves as inert text — the allowlist is the whole defence,
  // so widening it is the only safe way to add a colour or an underline.
  | { type: "highlight"; children: InlineNode[] }
  | { type: "underline"; children: InlineNode[] }
  // Code keeps a flat `text` on purpose: its content is literal by definition, so recursing
  // into it would be a bug, not a feature.
  | { type: "code"; text: string }
  | { type: "citation"; token: CitationToken };

export type BlockNode =
  | { type: "paragraph"; inline: InlineNode[] }
  | { type: "heading"; level: number; inline: InlineNode[] }
  | { type: "thematicBreak" }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "codeBlock"; text: string };

// == and ++ require non-space at both ends of their content, which ** and * predate and do
// not. That is not fussiness: ++ is a real token in prose ("C++"), and without the rule
// "C++ vs C++ debate" pairs the two C++ into an underline and swallows " vs C". "2 == 2 and
// 3 == 3" fails the same way. CommonMark rejects "** bold **" for exactly this reason, so
// the stricter form is also the more conventional one. ** and * are left as they are —
// changing them would alter how existing answers render, and a literal "**" in prose is not
// a realistic thing to type.
// Bold and italic must tolerate the *other* marker inside them, or the most ordinary nested
// markup there is — "**bold *italic* text**" — fails to match as bold and the tokenizer
// re-pairs the asterisks across the span, emitting a stray "*" into the prose. So bold accepts
// any lone "*" but never a "**" (which would let one bold run swallow the next), and italic
// accepts a whole "**" run but never a lone "*". Each therefore stops at its own closing
// marker, and the recursion in parseInline does the rest.
//
// Bold needs one more atom: a "*" sitting immediately before its own closing "**". Without it
// the two markers cannot end together, so "***both***" and "**bold *italic***" — where the
// inner run closes flush against the outer one — matched one "*" short and spilled the
// remainder into the text. "Nested" is not the same property as "ends at the same place", and
// only the first was covered until this case was reported.
//
// That atom needs the "(?!\*)" too. Written as a bare "\*(?=\*\*)" it also matches the first
// star of a four-star run, so "**a****b**" — two bold runs with no gap — closed one character
// late and produced bold("a**") followed by literal "b**". The lookahead must therefore mean
// "immediately before a closing \*\* that is not itself part of a longer run".
//
// One case stays divergent by choice: "**a***b*", where a run ends exactly where the next begins,
// is <strong>a</strong><em>b</em> in CommonMark but not here. Resolving that needs a delimiter
// stack rather than a regex, which is a different parser than this one is meant to be. It is
// pinned by a test so the behaviour is a recorded decision, and it degrades to visible text
// rather than to anything unsafe.
const INLINE_TOKEN =
  /\[S[^[\]]*\]|\*\*(?:[^*]|\*(?!\*)|\*(?=\*\*(?!\*)))+\*\*|\*(?!\*)(?:[^*]|\*\*)+?\*(?!\*)|`[^`]+`|==[^\s=](?:[^=\n]*[^\s=])?==|\+\+[^\s+](?:[^+\n]*[^\s+])?\+\+/g;

// Defence in depth, and — measured, not assumed — currently unreachable. No marker may contain
// itself: bold rejects a nested "**", italic a lone "*", and == and ++ reject their own
// character. With four marker types that caps real nesting at four emphasis levels, and a fifth
// level makes the *outer* match fail rather than nesting deeper. So this limit cannot fire
// today. It stays because the thing keeping recursion finite is a property of four regexes
// rather than anything structural, and adding a fifth marker or relaxing one pattern would
// change that quietly. At the limit the span degrades to literal text, which is the same
// treatment this parser already gives anything it does not recognize.
const MAX_DEPTH = 6;

export function parseInline(text: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  const citations = new Map(parseCitations(text).map((c) => [c.start, c]));
  const descend = (inner: string): InlineNode[] =>
    depth >= MAX_DEPTH ? [{ type: "text", text: inner }] : parseInline(inner, depth + 1);

  for (const match of text.matchAll(INLINE_TOKEN)) {
    const start = match.index;
    if (start > last) nodes.push({ type: "text", text: text.slice(last, start) });
    const raw = match[0];
    const citation = citations.get(start);
    if (citation && citation.raw === raw) {
      nodes.push({ type: "citation", token: citation });
    } else if (raw.startsWith("**")) {
      nodes.push({ type: "bold", children: descend(raw.slice(2, -2)) });
    } else if (raw.startsWith("`")) {
      nodes.push({ type: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("==")) {
      nodes.push({ type: "highlight", children: descend(raw.slice(2, -2)) });
    } else if (raw.startsWith("++")) {
      nodes.push({ type: "underline", children: descend(raw.slice(2, -2)) });
    } else if (raw.startsWith("*")) {
      nodes.push({ type: "italic", children: descend(raw.slice(1, -1)) });
    } else {
      nodes.push({ type: "text", text: raw });
    }
    last = start + raw.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

const LIST_ITEM = /^(\d+)\.\s+|^[-*]\s+/;
// Checked before LIST_ITEM. There is no ambiguity with "- item": a list bullet requires
// whitespace after the marker, and a thematic break is nothing but markers to end of line.
const THEMATIC_BREAK = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;

// Blocks are found line by line rather than by splitting on blank lines alone. Models emit a
// heading and its first sentence on consecutive lines far more often than they leave a blank
// line between them, and the blank-line-only split turned that whole run into one paragraph
// whose text happened to start with "###" — which is exactly how a heading ends up rendered
// as literal hashes.
function parseLines(lines: string[]): BlockNode[] {
  const blocks: BlockNode[] = [];
  let para: string[] = [];
  let items: string[] = [];
  let ordered = false;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", inline: parseInline(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (items.length) {
      blocks.push({
        type: "list",
        ordered,
        items: items.map((l) => parseInline(l.slice(LIST_ITEM.exec(l)![0].length))),
      });
    }
    items = [];
  };
  const flush = () => {
    flushList();
    flushPara();
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (THEMATIC_BREAK.test(line)) {
      flush();
      blocks.push({ type: "thematicBreak" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        inline: parseInline(heading[2].trim()),
      });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const isOrdered = /^\s*\d/.test(line);
      // A change of list kind starts a new list rather than silently relabelling the old one.
      if (items.length && isOrdered !== ordered) flushList();
      if (!items.length) ordered = isOrdered;
      flushPara();
      items.push(line);
      continue;
    }
    flushList();
    para.push(line);
  }
  flush();
  return blocks;
}

export function parseMessage(text: string): BlockNode[] {
  const blocks: BlockNode[] = [];
  // Split on fenced code blocks first: their content must never be treated as markdown.
  const parts = text.split(/```([\s\S]*?)```/);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      blocks.push({ type: "codeBlock", text: part.replace(/^\n/, "").replace(/\n$/, "") });
      return;
    }
    blocks.push(...parseLines(part.split("\n")));
  });
  return blocks;
}
