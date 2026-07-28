// Strong's identifier helpers for the web client (M8.3). Same canonical form as
// bibleimport.canonical.normalize_strong_id and the API's lexicon router — intentionally
// re-implemented per layer so none of the three imports across the boundary.

// Match the public API's bounded identifier input. Five digits retain the KJV
// source's extra leading-zero padding (H07225) without Number overflow.
const STRONG_ID = /^([HGhg])([0-9]{1,5})([A-Za-z]?)$/;

/** 'h1254' / 'H01254' / 'G26' -> 'H1254' / 'H1254' / 'G0026'; null when not a Strong's id. */
export function normalizeStrongId(value: string): string | null {
  const match = STRONG_ID.exec(value.trim());
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const number = String(Number(match[2])).padStart(4, "0");
  const suffix = match[3].toUpperCase();
  return `${letter}${number}${suffix}`;
}

export function strongLexiconWorkId(strongId: string): "strongsgreek" | "strongshebrew" {
  return strongId.startsWith("G") ? "strongsgreek" : "strongshebrew";
}
