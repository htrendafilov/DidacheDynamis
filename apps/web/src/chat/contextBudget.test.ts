import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_ANSWER_TOKENS,
  DEFAULT_PER_SOURCE_CAP,
  DEFAULT_TOTAL_BUDGET,
  MAX_MAX_ANSWER_TOKENS,
  MAX_PER_SOURCE_CAP,
  effectiveMaxAnswerTokens,
  resolveContextBudget,
} from "./contextBudget";

describe("resolveContextBudget", () => {
  it("falls back to the measured defaults when nothing is stored", () => {
    expect(resolveContextBudget()).toEqual({
      perSourceCap: DEFAULT_PER_SOURCE_CAP,
      totalBudget: DEFAULT_TOTAL_BUDGET,
      maxAnswerTokens: DEFAULT_MAX_ANSWER_TOKENS,
    });
  });

  it("clamps values outside the offered range instead of trusting them", () => {
    const budget = resolveContextBudget({
      chatPerSourceCap: 999_999,
      chatTotalBudget: 1,
      chatMaxAnswerTokens: 999_999,
    });
    expect(budget.perSourceCap).toBe(MAX_PER_SOURCE_CAP);
    expect(budget.maxAnswerTokens).toBe(MAX_MAX_ANSWER_TOKENS);
  });

  it("never lets the total sit below the per-source cap", () => {
    // Otherwise a source clears the per-source limit only to be evicted by the total, and
    // raising the cap appears to do nothing — a trap, not a budget.
    const budget = resolveContextBudget({ chatPerSourceCap: 25000, chatTotalBudget: 1000 });
    expect(budget.totalBudget).toBeGreaterThanOrEqual(budget.perSourceCap);
  });

  it("ignores malformed stored values", () => {
    const budget = resolveContextBudget({ chatPerSourceCap: Number.NaN });
    expect(budget.perSourceCap).toBe(DEFAULT_PER_SOURCE_CAP);
  });
});

describe("effectiveMaxAnswerTokens", () => {
  const budget = resolveContextBudget({ chatMaxAnswerTokens: 8000 });

  it("never exceeds what the model itself accepts", () => {
    expect(effectiveMaxAnswerTokens(budget, 2048)).toBe(2048);
  });

  it("keeps the reader's setting when the model allows more", () => {
    expect(effectiveMaxAnswerTokens(budget, 65536)).toBe(8000);
  });

  it("keeps the reader's setting when the model reports no ceiling", () => {
    expect(effectiveMaxAnswerTokens(budget, null)).toBe(8000);
    expect(effectiveMaxAnswerTokens(budget, undefined)).toBe(8000);
  });
});
