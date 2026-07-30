import { describe, expect, it } from "vitest";

import type { CrossReferences, Document, Passage, StrongEntry } from "../data/api";
import {
  crossReferencesToText,
  documentToText,
  parseVerseRange,
  passageToText,
  strongEntryToText,
} from "./normalize";
import fixtures from "./__fixtures__/cir.json";

// Real CIR pulled from the actual FastAPI routes over the same importer test fixtures
// apps/api/tests/conftest.py uses (see scripts/build_chat_normalize_fixtures.py) — not
// hand-written objects, per plan/chat/m9.3-grounded-assistant.md §2.
const f = fixtures as Record<string, unknown>;

describe("passageToText", () => {
  it("emits the verse number and the words-of-Christ text, dropping the wj flag", () => {
    expect(passageToText(f.passage_john3 as Passage)).toBe(
      "16 For God so loved the world.",
    );
  });

  it("keeps poetry line breaks across Line boundaries and drops level", () => {
    expect(passageToText(f.passage_ps23_poetry as Passage)).toBe(
      "1 The LORD is my shepherd;\nI shall lack nothing.",
    );
  });

  it("filters to a single requested verse", () => {
    const full = f.passage_john3 as Passage;
    expect(passageToText(full, "16")).toBe("16 For God so loved the world.");
    expect(passageToText(full, "99")).toBe("");
  });

  it("matches a passage the server already filtered by ?verses=", () => {
    expect(passageToText(f.passage_john3_v16 as Passage)).toBe(
      passageToText(f.passage_john3 as Passage, "16"),
    );
  });

  // ContextPicker's verse-range input is free text, and the API's own verses param
  // accepts an unbounded range like "1-999999999". Filtering must stay O(verses actually
  // in the passage) regardless of what the range string claims, never expand it into a
  // collection sized to the range itself.
  it("does not hang or allocate proportionally to an absurdly large requested range", () => {
    const full = f.passage_john3 as Passage;
    const start = Date.now();
    const result = passageToText(full, "1-999999999");
    expect(Date.now() - start).toBeLessThan(50);
    expect(result).toBe("16 For God so loved the world."); // still just the one real verse
  });
});

describe("parseVerseRange", () => {
  it("parses a single verse", () => {
    expect(parseVerseRange("16")).toEqual({ start: 16, end: 16 });
  });

  it("parses a range", () => {
    expect(parseVerseRange("16-18")).toEqual({ start: 16, end: 18 });
  });

  it("accepts an absurdly large range as bounds only, never expanding it", () => {
    expect(parseVerseRange("1-999999999")).toEqual({ start: 1, end: 999999999 });
  });

  it.each([
    ["", "empty"],
    ["abc", "non-numeric"],
    ["18-16", "end before start"],
    ["16-", "missing end"],
    ["-16", "missing start"],
    ["16,18", "comma-separated, not a range"],
  ])("returns null for %s (%s)", (input) => {
    expect(parseVerseRange(input)).toBeNull();
  });
});

describe("documentToText", () => {
  it("puts a heading on its own line, ahead of a paragraph", () => {
    expect(documentToText((f.commentary_john3 as { entries: { body: Document }[] }).entries[0].body)).toBe(
      "God's love.\n\nThe love of God is shown in the gift of his Son.",
    );
  });

  it("prefixes a quotation block with '> ' and drops emphasis/superscript flags", () => {
    const body = (
      f.commentary_john3_sword_quotation as { entries: { body: Document }[] }
    ).entries[0].body;
    expect(documentToText(body)).toBe(
      "God's Love.\n\n" +
        "> 16 For God so loved the world, that he gave his only begotten Son.\n\n" +
        "The gift of the Son shows divine love.",
    );
  });

  it("keeps a paragraph break between multiple entries in the same document", () => {
    expect(documentToText((f.dictionary_shepherd as { body: Document }).body)).toBe(
      "One who tends a flock.\n\nUsed figuratively of a leader.",
    );
  });

  it("drops a DocumentRun.ref link target but keeps its visible text", () => {
    const body = (
      f.general_book_baptist1689 as {
        sections: { children: { body: Document }[] }[];
      }
    ).sections[0].children[0].body;
    const text = documentToText(body);
    expect(text).toContain("2 Tim. 3:16");
    expect(text).not.toContain("2Tim.3.16");
  });
});

describe("strongEntryToText", () => {
  it("includes the lemma, transliteration, and full definition", () => {
    const text = strongEntryToText(f.strong_g1722_en as StrongEntry);
    expect(text).toContain("ἐν");
    expect(text).toContain("en");
    expect(text).toContain("a primary preposition denoting");
    expect(text).toContain("see GREEK for 1519");
  });

  it("does not break when transliteration is missing", () => {
    const text = strongEntryToText(f.strong_h0001 as StrongEntry);
    expect(text.startsWith("'ab")).toBe(true);
  });
});

describe("crossReferencesToText", () => {
  it("lists every reference as a human-readable target", () => {
    const text = crossReferencesToText(f.xref_john3_16 as CrossReferences);
    expect(text.split("\n")).toEqual(["Rom 5:8", "1John 4:9-10", "Rom 8:32"]);
  });
});
