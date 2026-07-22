// Interim deep links for General Book sections, encoded in the URL *hash* so they can never collide
// with the Dropbox OAuth query params (?code / ?state) and need no SPA server routing. The broader
// canonical URL scheme for every pane type is planned separately (plan/linking_and_embeds.md §1);
// this is the M6 follow-up for sharing a book section.

export interface BookDeepLink {
  workId: string;
  sectionId: string;
}

const PREFIX = "#/book/";
// Reject only clearly unsafe/ambiguous characters; slugs may contain Unicode letters (non-English
// books), so we do not allow-list [a-z]. Real existence is validated downstream (known work id +
// the reader falls back to the first section when a section id is unknown).
const UNSAFE = /[\s/#?]/;

export function bookHash(workId: string, sectionId: string): string {
  return `${PREFIX}${encodeURIComponent(workId)}/${encodeURIComponent(sectionId)}`;
}

export function parseBookHash(hash: string): BookDeepLink | null {
  if (!hash.startsWith(PREFIX)) return null;
  const rest = hash.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  let workId: string;
  let sectionId: string;
  try {
    workId = decodeURIComponent(rest.slice(0, slash));
    sectionId = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null; // malformed percent-encoding
  }
  if (!workId || !sectionId || UNSAFE.test(workId) || UNSAFE.test(sectionId)) return null;
  return { workId, sectionId };
}

// Bible passage deep link (#/b/<work>/<osis>/<chapter>). Read on load so the external embed's
// "open on bible.trendafilovi.net" link lands on the cited chapter; part of the same interim scheme.
export interface BibleDeepLink {
  workId: string;
  osis: string;
  chapter: number;
}

const BIBLE_PREFIX = "#/b/";

export function bibleHash(workId: string, osis: string, chapter: number): string {
  return `${BIBLE_PREFIX}${encodeURIComponent(workId)}/${encodeURIComponent(osis)}/${chapter}`;
}

export function parseBibleHash(hash: string): BibleDeepLink | null {
  if (!hash.startsWith(BIBLE_PREFIX)) return null;
  const parts = hash.slice(BIBLE_PREFIX.length).split("/");
  if (parts.length !== 3) return null;
  let workId: string;
  let osis: string;
  try {
    workId = decodeURIComponent(parts[0]);
    osis = decodeURIComponent(parts[1]);
  } catch {
    return null;
  }
  const chapter = Number(parts[2]);
  if (!workId || !osis || UNSAFE.test(workId) || UNSAFE.test(osis)) return null;
  if (!Number.isInteger(chapter) || chapter < 1) return null;
  return { workId, osis, chapter };
}
