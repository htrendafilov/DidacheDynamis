// Bounds the whole outgoing request, not just its sources.
//
// context.ts budgets StudySources to 8,000 tokens (§4). Nothing budgeted the other two
// inputs: the replayed conversation, which grows by a full question and answer every turn
// and was resent in its entirety each time, and the system contract plus the question
// itself. `ChatModel.contextLength` was fetched from the provider and shown in the model
// picker, but never compared against anything — so a long thread simply grew the request
// until the provider rejected it, or silently truncated it from the front, which is
// precisely where the system contract lives.
//
// Estimates come from tokens.ts, which is calibrated to over-count rather than under-count
// (§3). Over-counting here costs a little replayed history; under-counting costs the turn.
import type { ChatMessage } from "./client";
import { estimateProseTokens } from "./tokens";

// A ceiling on replayed conversation that does not scale with the model's window: a
// million-token context is not a reason to resend the whole thread on every turn. The
// reader pays for those tokens, and relevance does not improve with depth.
export const MAX_HISTORY_TOKENS = 4000;

// Headroom for what a character-count estimate cannot see: per-message role and JSON
// framing, the provider's own chat template, and the estimator's own error band.
export const RESERVE_TOKENS = 512;

export interface RequestBudget {
  /** The prefix of `history` that fits, oldest dropped first. */
  history: ChatMessage[];
  /** How many turns were dropped to fit; 0 when everything fit. */
  droppedTurns: number;
  /** True when the request cannot fit even with no history at all. */
  overflows: boolean;
}

export interface RequestBudgetOptions {
  /** Tokens for the parts that cannot be dropped: system contract + sources + question. */
  fixedTokens: number;
  /** What was reserved for the answer (`max_tokens`), which shares the same window. */
  maxCompletionTokens: number;
  /** The selected model's window. Undefined for a router that does not report one, in
   *  which case only MAX_HISTORY_TOKENS applies — an unknown window is not a licence to
   *  send an unbounded request. */
  contextLength?: number;
}

export function historyTokens(history: readonly ChatMessage[]): number {
  return history.reduce((sum, m) => sum + estimateProseTokens(m.content), 0);
}

export function planRequestBudget(
  history: readonly ChatMessage[],
  { fixedTokens, maxCompletionTokens, contextLength }: RequestBudgetOptions,
): RequestBudget {
  const unavoidable = fixedTokens + maxCompletionTokens + RESERVE_TOKENS;
  const overflows = contextLength != null && unavoidable > contextLength;

  let available = MAX_HISTORY_TOKENS;
  if (contextLength != null) {
    available = Math.min(available, contextLength - unavoidable);
  }

  // Newest first: the most recent exchange is the one a follow-up question depends on, so
  // it is the last thing to go.
  const keptReversed: ChatMessage[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateProseTokens(history[i].content);
    if (used + cost > available) break;
    keptReversed.push(history[i]);
    used += cost;
  }
  const kept = keptReversed.reverse();

  return { history: kept, droppedTurns: history.length - kept.length, overflows };
}
