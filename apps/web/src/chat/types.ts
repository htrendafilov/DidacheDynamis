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
}

// What the user (via ContextPicker, step 5) has asked to include for this turn. context.ts
// treats every chip here as "on" — the picker is responsible for not passing disabled ones.
export type ContextChip =
  | { kind: "bible"; workId: string; osis: string; chapter: number; verses?: string }
  | { kind: "commentary"; workId: string; osis: string; chapter: number; verse?: number }
  | { kind: "dictionary"; workId: string; headword: string }
  | { kind: "lexicon"; strongId: string }
  | { kind: "xref"; osis: string; chapter: number; verse: number; previewWork: string }
  | { kind: "book"; workId: string; sectionId: string }
  | { kind: "note"; noteId: string };

export type DropReason = "licence" | "unavailable" | "over-cap" | "budget" | "duplicate";

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
}
