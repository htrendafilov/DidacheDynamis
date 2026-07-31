// Reader-configurable context budget (M9.3c, m9.3-grounded-assistant.md §4 "Budget
// calibration"). These were fixed constants; measurement against the corpus showed the
// 2,000-token per-source cap admitted exactly one of Matthew Henry's 938 chapters, which
// made two of §12's shipped capabilities unreachable.
//
// Defaults are chosen from that measurement rather than picked: at 6,000 tokens 79% of
// verse-scoped Matthew Henry entries fit (median 3,593, p90 8,087). The maximum is set so a
// reader willing to pay can take whole chapters — 25,000 covers 87% of them, 32,000 covers
// 92%. The largest chapters (max 93,568) fit at no offered setting and are reported as
// dropped, never trimmed.

export interface ContextBudget {
  /** A single source larger than this is dropped whole — never truncated. */
  perSourceCap: number;
  /** Ceiling on the sum of all kept sources. */
  totalBudget: number;
}

export const DEFAULT_PER_SOURCE_CAP = 6000;
export const DEFAULT_TOTAL_BUDGET = 16000;

export const MIN_PER_SOURCE_CAP = 500;
export const MAX_PER_SOURCE_CAP = 32000;
export const MIN_TOTAL_BUDGET = 500;
export const MAX_TOTAL_BUDGET = 64000;

/** Independent of the token budget: a hard ceiling on how many sources one turn may carry. */
export const MAX_SOURCES = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Turns whatever is stored in Settings into a usable budget. Absent or malformed values fall
 * back to the defaults, and `totalBudget` is raised to at least `perSourceCap`: a source that
 * clears the per-source cap only to be evicted by a smaller total is a trap, not a budget —
 * the reader would raise the cap, see no change, and have nothing on screen explaining why.
 */
export function resolveContextBudget(settings?: {
  chatPerSourceCap?: number;
  chatTotalBudget?: number;
}): ContextBudget {
  const rawPerSource = settings?.chatPerSourceCap;
  const rawTotal = settings?.chatTotalBudget;
  const perSourceCap = Number.isFinite(rawPerSource)
    ? clamp(rawPerSource as number, MIN_PER_SOURCE_CAP, MAX_PER_SOURCE_CAP)
    : DEFAULT_PER_SOURCE_CAP;
  const totalBudget = Number.isFinite(rawTotal)
    ? clamp(rawTotal as number, MIN_TOTAL_BUDGET, MAX_TOTAL_BUDGET)
    : DEFAULT_TOTAL_BUDGET;
  return { perSourceCap, totalBudget: Math.max(totalBudget, perSourceCap) };
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = resolveContextBudget();
