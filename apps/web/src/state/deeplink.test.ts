import { describe, expect, it } from "vitest";

import { bookHash, parseBookHash } from "./deeplink";

describe("book deep links", () => {
  it("round-trips a work id and dotted section id", () => {
    const hash = bookHash("baptist1689", "chapter-1-scripture.1");
    expect(hash).toBe("#/book/baptist1689/chapter-1-scripture.1");
    expect(parseBookHash(hash)).toEqual({
      workId: "baptist1689",
      sectionId: "chapter-1-scripture.1",
    });
  });

  it("percent-encodes and decodes Unicode section slugs", () => {
    const hash = bookHash("bg-book", "глава-1");
    expect(parseBookHash(hash)).toEqual({ workId: "bg-book", sectionId: "глава-1" });
  });

  it("ignores hashes that are not book links", () => {
    expect(parseBookHash("")).toBeNull();
    expect(parseBookHash("#/bible/web/John/3")).toBeNull();
    expect(parseBookHash("#/book/baptist1689")).toBeNull(); // no section
    expect(parseBookHash("#/book//chapter-1")).toBeNull(); // empty work id
    expect(parseBookHash("#/book/baptist1689/")).toBeNull(); // empty section id
  });

  it("rejects unsafe or malformed input", () => {
    expect(parseBookHash("#/book/a b/c")).toBeNull(); // whitespace
    expect(parseBookHash("#/book/%E0%A4/x")).toBeNull(); // broken percent-encoding
  });
});
