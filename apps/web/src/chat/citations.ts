// Citation parsing + resolution (M9.3 step 4, §7). The manifest is a plain array
// captured at send time; nothing here mutates it, and no later turn, edit, or context
// change can make a stale manifest resolve differently — a caller that wants "current"
// behaviour must pass a new manifest, not update this one.
import { strongLexiconWorkId } from "../data/strongs";
import type { StudySource } from "./types";

export type SourceManifest = readonly StudySource[];

export function buildManifest(sources: readonly StudySource[]): SourceManifest {
  return Object.freeze([...sources]);
}

export interface CitationToken {
  raw: string; // exact matched substring, e.g. "[S1]"
  start: number;
  end: number;
  // The canonical id ("S1") if the bracket parses to exactly that shape; null for a
  // fabricated, duplicated-digit, or otherwise malformed attempt (e.g. "[S01]", "[Sx]",
  // "[S1,S2]") — those are never looked up, and render as inert text (§8, §10).
  id: string | null;
}

// Only brackets that open with "[S" are even considered citation attempts — plain text
// like "[1]" or "[note]" is not flagged as an unverified citation at all, matching what
// the system contract (prompt.ts) actually instructs the model to produce.
const CITATION_ATTEMPT = /\[S[^[\]]*\]/g;
const CANONICAL_ID = /^S[1-9]\d*$/;

export function parseCitations(text: string): CitationToken[] {
  return [...text.matchAll(CITATION_ATTEMPT)].map((match) => {
    const raw = match[0];
    const inner = raw.slice(1, -1);
    return {
      raw,
      start: match.index,
      end: match.index + raw.length,
      id: CANONICAL_ID.test(inner) ? inner : null,
    };
  });
}

// Resolves an id against the manifest. Zero matches (unknown) and more than one match
// (a corrupt manifest — buildContext never produces this, but resolve does not trust
// that) both return null rather than guessing.
export function resolve(id: string, manifest: SourceManifest): StudySource | null {
  const matches = manifest.filter((s) => s.id === id);
  return matches.length === 1 ? matches[0] : null;
}

// What a resolved citation navigates to (§7's table), expressed as data rather than a
// direct store call: this module has no access to the Zustand store (a React hook), so
// the component that renders a citation is the one that actually dispatches the action.
export type NavigationIntent =
  | { action: "openPassage"; workId: string; osis: string; chapter: number; verse?: number }
  | { action: "openCommentary"; workId: string; osis: string; chapter: number }
  | { action: "openDictionary"; workId: string; headword: string }
  | { action: "openBookSection"; workId: string; sectionId: string }
  | { action: "requestOpenNote"; noteId: string; osis: string; chapter: number };

export function navigationIntent(source: StudySource): NavigationIntent {
  const t = source.canonicalTarget;
  switch (t.kind) {
    case "bible":
      return { action: "openPassage", workId: t.workId, osis: t.osis, chapter: t.chapter, verse: t.verse };
    case "commentary":
      return { action: "openCommentary", workId: t.workId, osis: t.osis, chapter: t.chapter };
    case "dictionary":
      return { action: "openDictionary", workId: t.workId, headword: t.headword };
    case "lexicon":
      // DictionaryPane routes type === "lexicon" works to the Strong's view, keyed by
      // the normalized Strong's id in the headword slot (DictionaryPane.tsx).
      return { action: "openDictionary", workId: strongLexiconWorkId(t.strongId), headword: t.strongId };
    case "xref":
      return { action: "openPassage", workId: t.workId, osis: t.osis, chapter: t.chapter, verse: t.verse };
    case "book":
      return { action: "openBookSection", workId: t.workId, sectionId: t.sectionId };
    case "note":
      return { action: "requestOpenNote", noteId: t.noteId, osis: t.osis, chapter: t.chapter };
  }
}
