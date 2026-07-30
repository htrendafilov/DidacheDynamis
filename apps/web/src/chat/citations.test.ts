import { describe, expect, it } from "vitest";

import { buildManifest, navigationIntent, parseCitations, resolve } from "./citations";
import type { StudySource } from "./types";

function source(overrides: Partial<StudySource> = {}): StudySource {
  return {
    id: "S1",
    kind: "bible",
    workId: "web",
    label: "John 3:16 (WEB)",
    canonicalTarget: { kind: "bible", workId: "web", osis: "John", chapter: 3, verse: 16 },
    language: "en",
    excerpt: "16 For God so loved the world.",
    contentVersion: "v1",
    estimatedTokens: 10,
    ...overrides,
  };
}

describe("parseCitations", () => {
  it("finds well-formed citation tokens with correct positions and ids", () => {
    const text = "See [S1] and also [S12].";
    const tokens = parseCitations(text);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ raw: "[S1]", id: "S1", start: 4, end: 8 });
    expect(tokens[1]).toMatchObject({ raw: "[S12]", id: "S12" });
  });

  it.each([
    ["[S]", "empty id"],
    ["[S0]", "S0 is never assigned"],
    ["[S01]", "leading zero"],
    ["[Sabc]", "non-numeric"],
    ["[S1.5]", "non-integer"],
    ["[S1,S2]", "multiple ids in one bracket"],
    ["[S1 ]", "trailing space"],
  ])("marks %s (%s) as a malformed attempt, not a resolvable id", (raw) => {
    const tokens = parseCitations(`text ${raw} text`);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].id).toBeNull();
    expect(tokens[0].raw).toBe(raw);
  });

  it("does not flag ordinary brackets that are not citation attempts", () => {
    expect(parseCitations("See note [1] and [random].")).toEqual([]);
  });

  it("finds nothing in plain text", () => {
    expect(parseCitations("No citations here.")).toEqual([]);
  });
});

describe("resolve", () => {
  it("resolves a known id to its source", () => {
    const manifest = buildManifest([source({ id: "S1" }), source({ id: "S2" })]);
    expect(resolve("S2", manifest)?.id).toBe("S2");
  });

  it("returns null for an id the manifest does not contain (fabricated citation)", () => {
    const manifest = buildManifest([source({ id: "S1" }), source({ id: "S2" }), source({ id: "S3" })]);
    expect(resolve("S9", manifest)).toBeNull();
  });

  it("returns null rather than guessing when the manifest has a duplicate id", () => {
    // buildContext never produces this, but resolve must not trust that at its own layer.
    const manifest = buildManifest([source({ id: "S1", label: "A" }), source({ id: "S1", label: "B" })]);
    expect(resolve("S1", manifest)).toBeNull();
  });

  it("is immutable: mutating the array passed to buildManifest does not change resolution", () => {
    const sources = [source({ id: "S1" })];
    const manifest = buildManifest(sources);
    sources.push(source({ id: "S2" }));
    sources[0] = source({ id: "S1", label: "mutated" });
    expect(resolve("S2", manifest)).toBeNull();
    expect(resolve("S1", manifest)?.label).toBe("John 3:16 (WEB)");
  });
});

describe("navigationIntent", () => {
  it("maps bible to openPassage with the verse", () => {
    expect(navigationIntent(source())).toEqual({
      action: "openPassage",
      workId: "web",
      osis: "John",
      chapter: 3,
      verse: 16,
    });
  });

  it("maps commentary to openCommentary", () => {
    const s = source({ kind: "commentary", canonicalTarget: { kind: "commentary", workId: "mhc", osis: "John", chapter: 3 } });
    expect(navigationIntent(s)).toEqual({ action: "openCommentary", workId: "mhc", osis: "John", chapter: 3 });
  });

  it("maps dictionary to openDictionary", () => {
    const s = source({ kind: "dictionary", canonicalTarget: { kind: "dictionary", workId: "easton", headword: "Grace" } });
    expect(navigationIntent(s)).toEqual({ action: "openDictionary", workId: "easton", headword: "Grace" });
  });

  it("maps lexicon to openDictionary via strongLexiconWorkId, headword = the Strong's id", () => {
    const s = source({ kind: "lexicon", canonicalTarget: { kind: "lexicon", strongId: "G3439" } });
    expect(navigationIntent(s)).toEqual({ action: "openDictionary", workId: "strongsgreek", headword: "G3439" });
    const h = source({ kind: "lexicon", canonicalTarget: { kind: "lexicon", strongId: "H0001" } });
    expect(navigationIntent(h)).toEqual({ action: "openDictionary", workId: "strongshebrew", headword: "H0001" });
  });

  it("maps xref to openPassage on the anchor verse", () => {
    const s = source({ kind: "xref", canonicalTarget: { kind: "xref", workId: "web", osis: "John", chapter: 3, verse: 16 } });
    expect(navigationIntent(s)).toEqual({ action: "openPassage", workId: "web", osis: "John", chapter: 3, verse: 16 });
  });

  it("maps book to openBookSection", () => {
    const s = source({ kind: "book", canonicalTarget: { kind: "book", workId: "baptist1689", sectionId: "chapter-1.1" } });
    expect(navigationIntent(s)).toEqual({ action: "openBookSection", workId: "baptist1689", sectionId: "chapter-1.1" });
  });

  it("maps note to requestOpenNote", () => {
    const s = source({ kind: "note", workId: undefined, canonicalTarget: { kind: "note", noteId: "note-1", osis: "John", chapter: 3 } });
    expect(navigationIntent(s)).toEqual({ action: "requestOpenNote", noteId: "note-1", osis: "John", chapter: 3 });
  });
});
