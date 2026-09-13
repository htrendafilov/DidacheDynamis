// The M9.4 turn as an explicit phase machine (m9.4-topical-questions.md §7, §7a). Pure
// types and helpers only; ChatPanel owns the state and the transitions.
//
// Why a machine and not a branch on send(): before M9.3's send() reaches buildContext it
// has already cleared the composer, appended an empty assistant row, flipped Send to Stop,
// and saved the user message. Every pre-stream step the search toggle adds — expansion,
// confirm, fan-out — needs a place to show progress, host an error, and be cancelled, and
// none of those may create rows the reader then has to see removed. So the turn carries
// its own state, and rows are created only when the answering call starts.
import type { ChatUsage } from "./client";
import type { ChatErrorKind } from "./errors";
import type { ContextChip, DroppedSource, StudySource } from "./types";

// Why the post-search manifest was empty. "noHits": the search matched nothing. "licence":
// matches were found and every one was blocked by ai_context_policy. "dropped": matches
// were found and every one was left out for another reason (over-cap, unavailable,
// budget) — including the reader's own chips, since the gate reads the complete manifest.
export type EmptyReason = "noHits" | "licence" | "dropped";

export type TurnPhase =
  | { kind: "idle" }
  | { kind: "expanding"; question: string }
  | { kind: "confirm"; question: string; terms: string[] }
  | { kind: "searching"; question: string; terms: string[] }
  | { kind: "streaming"; question: string }
  | { kind: "empty"; question: string; terms: string[]; reason: EmptyReason }
  | {
      kind: "error";
      question: string;
      error: ChatErrorKind;
      // Present when the failure was in the search stage: Retry re-searches these terms
      // rather than re-expanding, so a network blink does not cost a re-confirmation.
      terms?: string[];
      retryAfterSeconds?: number;
    };

// What a completed expansion contributes to the answer's chrome and its stored run.
export interface TurnExpansion {
  terms: string[]; // the confirmed terms — what was searched, not what was proposed
  contributed: boolean; // false when no expansion source survived buildContext
  model?: string; // the router's choice for the expansion call, when it differs
}

export const PRE_STREAM_PHASES = new Set<TurnPhase["kind"]>(["expanding", "confirm", "searching"]);

export function emptyReason(hitCount: number, dropped: readonly DroppedSource[]): EmptyReason {
  if (hitCount === 0) return "noHits";
  return dropped.some((d) => d.reason === "licence") ? "licence" : "dropped";
}

// Two model calls in one turn. onMeta/saveRun today do `partial.usage ?? m.usage`, which
// would REPLACE the expansion's usage with the answer's — and the reader who sees one
// answer would be shown half the tokens they paid for.
export function mergeUsage(a: ChatUsage | undefined, b: ChatUsage | undefined): ChatUsage | undefined {
  if (!a) return b;
  if (!b) return a;
  const sum = (x?: number, y?: number) => (x == null && y == null ? undefined : (x ?? 0) + (y ?? 0));
  return {
    promptTokens: sum(a.promptTokens, b.promptTokens),
    completionTokens: sum(a.completionTokens, b.completionTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
    reasoningTokens: sum(a.reasoningTokens, b.reasoningTokens),
    cost: sum(a.cost, b.cost),
    // Discloses the answering call's endpoint; the expansion call's is not what the
    // reader is looking at.
    isByok: b.isByok ?? a.isByok,
  };
}

export type ErrorAction = "retry" | "switchModel" | "openSettings" | "sendWithoutSearch" | "cancel";

// Every pre-stream error offers Cancel and Retry; the rest depend on what would actually
// fix it. A stranded phase — an error with no control on screen — is the failure this
// table exists to rule out (§7 [R3]).
export function errorActions(kind: ChatErrorKind): ErrorAction[] {
  switch (kind) {
    case "expansionFailed":
      return ["retry", "switchModel", "sendWithoutSearch", "cancel"];
    case "auth":
    case "credit":
      return ["openSettings", "retry", "cancel"];
    case "privacyConstraint":
    case "modelUnavailable":
      return ["switchModel", "retry", "cancel"];
    case "rateLimit":
    case "network":
    case "malformedStream":
    case "badRequest":
    case "emptyAnswer":
    case "contextOverflow":
    case "aborted":
      return ["retry", "cancel"];
  }
}

// Did the search put anything into the manifest? Path B sources carry searchExcerpt; Path A
// hits became ordinary chips and are indistinguishable from the reader's own in the
// manifest, so they are matched back to the hit chips by target. A source the reader ALSO
// chose counts — the search did find it — which is the honest reading for a "no results
// were used" label whose job is to flag a search that added nothing at all.
export function expansionContributed(sources: readonly StudySource[], hitChips: readonly ContextChip[]): boolean {
  return sources.some((s) => {
    if (s.searchExcerpt) return true;
    const t = s.canonicalTarget;
    return hitChips.some((chip) => {
      switch (chip.kind) {
        case "bible":
          return (
            t.kind === "bible" &&
            t.workId === chip.workId &&
            t.osis === chip.osis &&
            t.chapter === chip.chapter &&
            (chip.verses == null || String(t.verse) === chip.verses)
          );
        case "dictionary":
          return t.kind === "dictionary" && t.workId === chip.workId && t.headword === chip.headword;
        case "lexicon":
          return t.kind === "lexicon" && t.strongId === chip.strongId;
        default:
          return false;
      }
    });
  });
}
