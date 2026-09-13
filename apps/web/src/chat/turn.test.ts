import { describe, expect, it } from "vitest";

import type { ChatErrorKind } from "./errors";
import { emptyReason, errorActions, expansionContributed, mergeUsage } from "./turn";
import type { ContextChip, StudySource } from "./types";

describe("mergeUsage", () => {
  it("sums every numeric field across the expansion and answering calls", () => {
    expect(
      mergeUsage(
        { promptTokens: 40, completionTokens: 12, totalTokens: 52, cost: 0.001 },
        { promptTokens: 900, completionTokens: 300, totalTokens: 1300, reasoningTokens: 100, cost: 0.02, isByok: true },
      ),
    ).toEqual({ promptTokens: 940, completionTokens: 312, totalTokens: 1352, reasoningTokens: 100, cost: 0.021, isByok: true });
  });

  it("passes a lone side through untouched", () => {
    const only = { totalTokens: 7 };
    expect(mergeUsage(undefined, only)).toBe(only);
    expect(mergeUsage(only, undefined)).toBe(only);
    expect(mergeUsage(undefined, undefined)).toBeUndefined();
  });

  it("leaves a field undefined when neither side reports it, rather than inventing a zero", () => {
    expect(mergeUsage({ totalTokens: 1 }, { totalTokens: 2 })).toEqual({
      promptTokens: undefined,
      completionTokens: undefined,
      totalTokens: 3,
      reasoningTokens: undefined,
      cost: undefined,
      isByok: undefined,
    });
  });

  it("takes isByok from the answering call, falling back to the expansion's", () => {
    expect(mergeUsage({ isByok: true }, { isByok: false })?.isByok).toBe(false);
    expect(mergeUsage({ isByok: true }, {})?.isByok).toBe(true);
  });
});

describe("emptyReason", () => {
  it("is noHits when the search returned nothing at all", () => {
    expect(emptyReason(0, [])).toBe("noHits");
    expect(emptyReason(0, [{ label: "chip", kind: "bible", reason: "over-cap" }])).toBe("noHits");
  });

  it("is licence when hits existed and any was blocked by policy", () => {
    expect(
      emptyReason(3, [
        { label: "a", kind: "commentary", reason: "over-cap" },
        { label: "b", kind: "book", reason: "licence" },
      ]),
    ).toBe("licence");
  });

  it("is dropped when hits existed and all were left out for other reasons", () => {
    expect(emptyReason(2, [{ label: "a", kind: "commentary", reason: "over-cap" }])).toBe("dropped");
  });
});

describe("errorActions", () => {
  const kinds: ChatErrorKind[] = [
    "auth", "credit", "rateLimit", "modelUnavailable", "privacyConstraint", "emptyAnswer",
    "expansionFailed", "badRequest", "contextOverflow", "network", "malformedStream", "aborted",
  ];

  it.each(kinds)("%s offers Cancel and Retry — no phase can strand the turn", (kind) => {
    const actions = errorActions(kind);
    expect(actions).toContain("cancel");
    expect(actions).toContain("retry");
  });

  it("gives expansionFailed the three recovery routes plus Cancel", () => {
    expect(errorActions("expansionFailed")).toEqual(["retry", "switchModel", "sendWithoutSearch", "cancel"]);
  });

  it("sends key and credit problems to settings", () => {
    expect(errorActions("auth")).toContain("openSettings");
    expect(errorActions("credit")).toContain("openSettings");
  });

  it("offers a model switch where the model is the problem", () => {
    expect(errorActions("privacyConstraint")).toContain("switchModel");
    expect(errorActions("modelUnavailable")).toContain("switchModel");
  });

  it("offers send-without-search only where there are no terms yet to search", () => {
    for (const kind of kinds.filter((k) => k !== "expansionFailed")) {
      expect(errorActions(kind), kind).not.toContain("sendWithoutSearch");
    }
  });
});

describe("expansionContributed", () => {
  const source = (overrides: Partial<StudySource>): StudySource => ({
    id: "S1",
    kind: "bible",
    workId: "web",
    label: "",
    canonicalTarget: { kind: "bible", workId: "web", osis: "1Cor", chapter: 15, verse: 4 },
    language: "en",
    excerpt: "x",
    contentVersion: "v",
    estimatedTokens: 1,
    ...overrides,
  });
  const hitChips: ContextChip[] = [
    { kind: "bible", workId: "web", osis: "1Cor", chapter: 15, verses: "20" },
    { kind: "dictionary", workId: "easton", headword: "Resurrection" },
    { kind: "lexicon", strongId: "G386" },
  ];

  it("is true for a snippet source", () => {
    expect(expansionContributed([source({ kind: "commentary", searchExcerpt: true })], [])).toBe(true);
  });

  it("matches a Path A source back to its hit chip by target", () => {
    expect(expansionContributed([source({ canonicalTarget: { kind: "bible", workId: "web", osis: "1Cor", chapter: 15, verse: 20 } })], hitChips)).toBe(true);
    expect(expansionContributed([source({ kind: "dictionary", canonicalTarget: { kind: "dictionary", workId: "easton", headword: "Resurrection" } })], hitChips)).toBe(true);
    expect(expansionContributed([source({ kind: "lexicon", canonicalTarget: { kind: "lexicon", strongId: "G386" } })], hitChips)).toBe(true);
  });

  it("is false when every source is the reader's own and none matches a hit", () => {
    expect(expansionContributed([source({})], hitChips)).toBe(false); // verse 4, hit was verse 20
    expect(expansionContributed([], hitChips)).toBe(false);
  });
});
