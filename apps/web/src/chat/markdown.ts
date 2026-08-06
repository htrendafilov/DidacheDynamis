// A very small, safe parser for assistant answers (M9.3 step 5, §8). Paragraphs,
// unordered/ordered lists, bold, italic, ==highlight==, ++underline++, inline code, fenced
// code, and [S#] citations — nothing else. No raw HTML, no link auto-detection (a plain URL in the text is just
// text). Treat the input as hostile: this only ever produces a data tree: ChatMessage.tsx
// renders it as React elements, never via dangerouslySetInnerHTML, so anything this parser
// does not explicitly recognize (an HTML tag, a javascript: URL, a fake system-prompt
// line) stays inert literal text by construction — there is no code path that interprets it.
import { type CitationToken, parseCitations } from "./citations";

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  // Emphasis the reader asked for that plain markdown has no syntax for. Deliberately new
  // tokens rather than raw HTML: a <mark> or <u> the model wrote itself would arrive as an
  // HTML tag, which this parser leaves as inert text — the allowlist is the whole defence,
  // so widening it is the only safe way to add a colour or an underline.
  | { type: "highlight"; text: string }
  | { type: "underline"; text: string }
  | { type: "code"; text: string }
  | { type: "citation"; token: CitationToken };

export type BlockNode =
  | { type: "paragraph"; inline: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "codeBlock"; text: string };

const INLINE_TOKEN =
  /\[S[^[\]]*\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|==[^=\n]+==|\+\+[^+\n]+\+\+/g;

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let last = 0;
  const citations = new Map(parseCitations(text).map((c) => [c.start, c]));
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const start = match.index;
    if (start > last) nodes.push({ type: "text", text: text.slice(last, start) });
    const raw = match[0];
    const citation = citations.get(start);
    if (citation && citation.raw === raw) {
      nodes.push({ type: "citation", token: citation });
    } else if (raw.startsWith("**")) {
      nodes.push({ type: "bold", text: raw.slice(2, -2) });
    } else if (raw.startsWith("`")) {
      nodes.push({ type: "code", text: raw.slice(1, -1) });
    } else if (raw.startsWith("==")) {
      nodes.push({ type: "highlight", text: raw.slice(2, -2) });
    } else if (raw.startsWith("++")) {
      nodes.push({ type: "underline", text: raw.slice(2, -2) });
    } else if (raw.startsWith("*")) {
      nodes.push({ type: "italic", text: raw.slice(1, -1) });
    } else {
      nodes.push({ type: "text", text: raw });
    }
    last = start + raw.length;
  }
  if (last < text.length) nodes.push({ type: "text", text: text.slice(last) });
  return nodes;
}

const LIST_ITEM = /^(\d+)\.\s+|^[-*]\s+/;

function parseListBlock(block: string): BlockNode | null {
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;
  const matches = lines.map((l) => LIST_ITEM.exec(l));
  if (matches.some((m) => !m)) return null;
  const ordered = /^\d/.test(lines[0].trimStart());
  const items = lines.map((line, i) => parseInline(line.slice(matches[i]![0].length)));
  return { type: "list", ordered, items };
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
    for (const para of part.split(/\n{2,}/)) {
      if (!para.trim()) continue;
      const list = parseListBlock(para);
      blocks.push(list ?? { type: "paragraph", inline: parseInline(para) });
    }
  });
  return blocks;
}
