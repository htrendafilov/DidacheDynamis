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
