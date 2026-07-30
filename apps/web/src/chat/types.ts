// Shared types for the M9.3 grounded assistant. StudySource itself is built out in
// context.ts (M9.3 step 3); SourceKind lives here first because normalize.ts and
// tokens.ts (step 2) both need it and neither should depend on context.ts.
export type SourceKind =
  | "bible"
  | "commentary"
  | "dictionary"
  | "lexicon"
  | "xref"
  | "book"
  | "note";
