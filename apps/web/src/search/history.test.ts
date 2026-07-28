import { describe, expect, it } from "vitest";

import {
  loadSearchHistory,
  rememberSearch,
  removeSearch,
  saveSearchHistory,
  SEARCH_HISTORY_KEY,
  toggleSearchPinned,
  type SearchState,
} from "./history";

const base: SearchState = {
  query: "earth",
  refine: "",
  verseText: "",
  morphScheme: "",
  morph: "",
  sort: "relevance",
  canon: "",
  works: [],
  books: [],
  selected: "all",
};

describe("search history", () => {
  it("persists a versioned record and tolerates corrupt storage", () => {
    saveSearchHistory(rememberSearch([], base, 10));
    expect(loadSearchHistory()).toMatchObject([{ query: "earth", updatedAt: 10 }]);

    localStorage.setItem(SEARCH_HISTORY_KEY, "{broken");
    expect(loadSearchHistory()).toEqual([]);
  });

  it("deduplicates an effective search and retains its pin", () => {
    const first = rememberSearch([], base, 10);
    const pinned = toggleSearchPinned(first, first[0].id);
    const repeated = rememberSearch(
      pinned,
      {
        ...base,
        query: "  EARTH  ",
        works: [],
        books: [],
        selected: "bible",
      },
      20,
    );
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({
      query: "EARTH",
      selected: "bible",
      pinned: true,
      updatedAt: 20,
    });
  });

  it("distinguishes and restores scope, ordering, refinement, and selected group", () => {
    const scoped: SearchState = {
      ...base,
      refine: "created",
      sort: "canonical",
      canon: "ot",
      works: ["web"],
      books: ["Gen"],
      selected: "bible",
    };
    const entries = rememberSearch(rememberSearch([], base, 10), scoped, 20);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject(scoped);
    expect(removeSearch(entries, entries[0].id)).toEqual([entries[1]]);
  });

  it("includes Strong's text and morphology in the effective search", () => {
    const lexical: SearchState = {
      ...base,
      query: "G1093",
      verseText: "earth",
      morphScheme: "robinson",
      morph: "N-NSF",
      selected: "strongs",
    };
    const changed = { ...lexical, morph: "N-ASM" };
    const entries = rememberSearch(
      rememberSearch([], lexical, 10),
      changed,
      20,
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject(changed);
  });
});
