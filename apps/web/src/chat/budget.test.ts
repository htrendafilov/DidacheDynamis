import { describe, expect, it } from "vitest";

import {
  MAX_HISTORY_TOKENS,
  RESERVE_TOKENS,
  historyTokens,
  planRequestBudget,
} from "./budget";
import type { ChatMessage } from "./client";

function turn(role: ChatMessage["role"], chars: number, marker = "x"): ChatMessage {
  return { role, content: marker.repeat(chars) };
}

// Generous window, so only MAX_HISTORY_TOKENS binds.
const ROOMY = { fixedTokens: 100, maxCompletionTokens: 1500, contextLength: 1_000_000 };

describe("planRequestBudget", () => {
  it("keeps everything when the history is small", () => {
    const history = [turn("user", 40), turn("assistant", 40)];
    const budget = planRequestBudget(history, ROOMY);
    expect(budget.history).toEqual(history);
    expect(budget.droppedTurns).toBe(0);
    expect(budget.overflows).toBe(false);
  });

  it("caps replayed history at MAX_HISTORY_TOKENS regardless of how large the window is", () => {
    // 200 turns of ~460 tokens each: ~92,000 tokens of history that the old code resent in
    // full every turn because the model's window was large enough to hide the cost.
    const history = Array.from({ length: 200 }, (_, i) => turn(i % 2 ? "assistant" : "user", 1000));
    const budget = planRequestBudget(history, ROOMY);
    expect(historyTokens(budget.history)).toBeLessThanOrEqual(MAX_HISTORY_TOKENS);
    expect(budget.droppedTurns).toBeGreaterThan(0);
    expect(budget.history.length).toBeLessThan(history.length);
  });

  it("drops the oldest turns first and keeps the most recent exchange", () => {
    // ~2,743 tokens each at the prose divisor, so two of them already exceed the 4,000 cap.
    const history = [turn("user", 6000, "a"), turn("assistant", 6000, "b"), turn("user", 100, "c")];
    const budget = planRequestBudget(history, ROOMY);
    expect(budget.history).toEqual([history[1], history[2]]);
    expect(budget.droppedTurns).toBe(1);
  });

  it("shrinks history further when the model's window is the tighter constraint", () => {
    const history = Array.from({ length: 20 }, () => turn("user", 1000));
    const roomy = planRequestBudget(history, ROOMY);
    const tight = planRequestBudget(history, {
      fixedTokens: 3000,
      maxCompletionTokens: 1500,
      contextLength: 6000,
    });
    expect(historyTokens(tight.history)).toBeLessThan(historyTokens(roomy.history));
    expect(3000 + 1500 + RESERVE_TOKENS + historyTokens(tight.history)).toBeLessThanOrEqual(6000);
  });

  it("flags overflow when sources and question alone cannot fit, and sends no history", () => {
    const budget = planRequestBudget([turn("user", 100)], {
      fixedTokens: 9000,
      maxCompletionTokens: 1500,
      contextLength: 8000,
    });
    expect(budget.overflows).toBe(true);
    expect(budget.history).toEqual([]);
  });

  it("still bounds history when the model reports no context length", () => {
    const history = Array.from({ length: 200 }, () => turn("user", 1000));
    const budget = planRequestBudget(history, { fixedTokens: 100, maxCompletionTokens: 1500 });
    expect(budget.overflows).toBe(false);
    expect(historyTokens(budget.history)).toBeLessThanOrEqual(MAX_HISTORY_TOKENS);
  });

  it("never returns a partial message — turns are kept whole or dropped whole", () => {
    const history = [turn("user", 100_000), turn("assistant", 50)];
    const budget = planRequestBudget(history, ROOMY);
    for (const message of budget.history) {
      expect(history).toContainEqual(message);
    }
  });
});
