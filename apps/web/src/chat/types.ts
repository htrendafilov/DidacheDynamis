// Shared types for the M9.3 grounded assistant.
export type SourceKind =
  | "bible"
  | "commentary"
  | "dictionary"
  | "lexicon"
  | "xref"
  | "book"
  | "note";

// What a resolved citation (citations.ts, step 4) navigates to, via the existing store
// actions (m9.3-grounded-assistant.md §7). One variant per SourceKind.
export type CanonicalTarget =
  | { kind: "bible"; workId: string; osis: string; chapter: number; verse?: number }
  | { kind: "commentary"; workId: string; osis: string; chapter: number }
  | { kind: "dictionary"; workId: string; headword: string }
  | { kind: "lexicon"; strongId: string }
  | { kind: "xref"; workId: string; osis: string; chapter: number; verse: number }
  | { kind: "book"; workId: string; sectionId: string }
  | { kind: "note"; noteId: string; osis: string; chapter: number };

// A source built and budgeted by context.ts (§4). id is assigned only after all
// dropping, by buildContext itself — never accepted from the model or the caller.
export interface StudySource {
  id: `S${number}`;
  kind: SourceKind;
  workId?: string;
  label: string;
  canonicalTarget: CanonicalTarget;
  language: string;
  excerpt: string;
  contentVersion: string;
  estimatedTokens: number;
  // M9.4: the excerpt is an FTS search snippet, not the source's full text — it may begin
  // or end mid-sentence. The prompt says so (prompt.ts) and the UI marks it. Never set on
  // Bible text: scripture is always re-fetched whole (m9.4-topical-questions.md §3).
  searchExcerpt?: true;
}

// What the user (via ContextPicker, step 5) has asked to include for this turn. context.ts
// treats every chip here as "on" — the picker is responsible for not passing disabled ones.
export type ContextChip =
  | { kind: "bible"; workId: string; osis: string; chapter: number; verses?: string }
  // entryId (M9.4): a search hit names the exact entry it matched; with it set, the chip
  // fetches that one entry rather than every entry covering `verse`.
  | { kind: "commentary"; workId: string; osis: string; chapter: number; verse?: number; entryId?: number }
  | { kind: "dictionary"; workId: string; headword: string }
  | { kind: "lexicon"; strongId: string }
  | { kind: "xref"; osis: string; chapter: number; verse: number; previewWork: string }
  | { kind: "book"; workId: string; sectionId: string }
  | { kind: "note"; noteId: string };

// "budget" is the token budget, "count" the per-turn source limit: two different limits
// the reader raises in two different ways (or cannot raise at all), so one label for both
// sent readers to raise a budget that was not the constraint.
export type DropReason = "licence" | "unavailable" | "over-cap" | "budget" | "count" | "duplicate";

// Stable, locale-independent codes — never a human sentence — so the UI layer (which has
// useTranslation) can localize them and history.ts can store them without baking English
// text into saved data.
export type LicenceReasonCode =
  | "turnOnPrivacyRouting"
  | "confirmLoggingDisabled"
  | "policyUnknown"
  | "policyBlocked";

export interface DroppedSource {
  label: string;
  kind: SourceKind;
  reason: DropReason;
  detail?: LicenceReasonCode; // set only when reason === "licence"
  // Set only when reason === "over-cap": what the source would have cost, so the pre-send
  // summary can name a figure the reader can act on instead of just "too large".
  estimatedTokens?: number;
}
