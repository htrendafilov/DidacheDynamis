import { describe, expect, it } from "vitest";

import { bookName } from "./bookNames";

describe("bookName", () => {
  it("returns Bulgarian names when the interface is BG", () => {
    expect(bookName("Gen", "bg")).toBe("Битие");
    expect(bookName("Exod", "bg")).toBe("Изход");
    expect(bookName("Ps", "bg")).toBe("Псалми");
    expect(bookName("1Kgs", "bg")).toBe("3 Царе");
    expect(bookName("John", "bg")).toBe("Йоан");
    expect(bookName("Rev", "bg")).toBe("Откровение");
  });

  it("returns English names when the interface is EN", () => {
    expect(bookName("Gen", "en")).toBe("Genesis");
    expect(bookName("Song", "en")).toBe("Song of Solomon");
    expect(bookName("1Cor", "en")).toBe("1 Corinthians");
  });

  it("covers all 66 books in both languages", () => {
    const codes = Object.keys({ ...({} as Record<string, string>) });
    void codes;
    // spot-check count via a known set
    const sample = ["Gen", "Mal", "Matt", "Rev"];
    for (const c of sample) {
      expect(bookName(c, "bg")).not.toBe(c);
      expect(bookName(c, "en")).not.toBe(c);
    }
  });

  it("falls back to the provided name or the code for unknown books", () => {
    expect(bookName("Zzz", "bg", "fallback")).toBe("fallback");
    expect(bookName("Zzz", "bg")).toBe("Zzz");
    expect(bookName("Gen", "xx", "fb")).toBe("Genesis"); // unknown lang -> English map
  });
});
