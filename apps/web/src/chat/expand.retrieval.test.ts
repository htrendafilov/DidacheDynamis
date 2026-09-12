import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BibleHit,
  BookHit,
  CommentaryHit,
  DictionaryHit,
  SearchHit,
  SearchResponse,
  StrongsEntryHit,
  StrongsOccurrenceHit,
  Work,
} from "../data/api";

vi.mock("../data/api", () => ({ api: { search: vi.fn() } }));

import { api } from "../data/api";
import {
  MAX_MERGED_HITS,
  hitKey,
  hitsToContext,
  mapHit,
  mergeHits,
  searchTerms,
  stripHighlights,
} from "./expand";

const searchMock = vi.mocked(api.search);

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id,
    type: "commentary",
    language: "en",
    title: id,
    abbrev: id.toUpperCase(),
    direction: "ltr",
    versification: "kjv",
    license: "Public Domain",
    attribution: "",
    source_url: null,
    source_version: null,
    ai_context_policy: "allowed",
    ...overrides,
  };
}

const provenance = { provenance_id: "p" };

function bible(verse: number, work_id = "web"): BibleHit {
  return { kind: "bible", work_id, title: `1 Cor 15:${verse}`, snippet: "…", osis: "1Cor", chapter: 15, verse, ref: `1Cor.15.${verse}` };
}
function commentary(entry_id: number, verse_start: number | null, work_id = "mhc", snippet = "…<b>raised</b> up…"): CommentaryHit {
  return {
    kind: "commentary", work_id, title: "1 Cor 15", snippet, osis: "1Cor", chapter: 15, verse_start,
    is_chapter_introduction: verse_start === null, entry_id, unit_id: `u${entry_id}`, release_version: "r1",
    provenance_id: "p", provenance,
  };
}
function dictionary(headword: string, work_id = "easton"): DictionaryHit {
  return { kind: "dictionary", work_id, title: headword, snippet: "…", headword };
}
function book(section_id: string, work_id = "bcf1689", title = "Chapter 31 · Of the State of Man"): BookHit {
  return { kind: "book", work_id, title, snippet: "…the <b>resurrection</b> of the dead…", section_id };
}
function strongsEntry(strong_id: string): StrongsEntryHit {
  return { kind: "strongs_entry", work_id: "strongsgreek", title: strong_id, snippet: "…", strong_id, language: "grc", lemma: "ἀνάστασις", transliteration: null, occurrence_count: 1, verse_count: 1 };
}
function strongsOccurrence(verse: number): StrongsOccurrenceHit {
  return { kind: "strongs_occurrence", work_id: "kjv", title: `1 Cor 15:${verse}`, snippet: "…", strong_id: "G386", osis: "1Cor", chapter: 15, verse, ref: `1Cor.15.${verse}`, surfaces: ["resurrection"], occurrence_count: 1, morphology: [] };
}

// Five groups in the API's order, each capped at PREVIEW = 5 rows for a multi-type query.
function response(groups: SearchHit[][]): SearchResponse {
  const kinds = ["bible", "commentary", "dictionary", "book", "strongs"] as const;
  return {
    query: "q", refine: null, sort: "relevance", total: groups.flat().length,
    groups: groups.map((hits, i) => ({ type: kinds[i], total: hits.length, offset: 0, limit: 5, has_more: false, hits })),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("stripHighlights", () => {
  it("removes only the <b> and </b> literals the API emits", () => {
    expect(stripHighlights("…the <b>resurrection</b> of <b>the</b> dead…")).toBe("…the resurrection of the dead…");
  });

  it("leaves everything else in the snippet alone, including other angle brackets", () => {
    const snippet = "…<i>not</i> a highlight; a < b > c; <B>upper</B>…";
    expect(stripHighlights(snippet)).toBe(snippet);
  });
});

describe("hitKey — qualified by kind and work", () => {
  it("keeps two commentaries' first entries apart", () => {
    expect(hitKey(commentary(1, 1, "mhc"))).not.toBe(hitKey(commentary(1, 1, "other")));
  });

  it("keeps the same verse in two Bibles apart", () => {
    expect(hitKey(bible(4, "web"))).not.toBe(hitKey(bible(4, "kjv")));
  });

  it("keys a Strong's occurrence identically to a plain hit on that verse, since both map to one bible chip", () => {
    expect(hitKey(strongsOccurrence(4))).toBe(hitKey(bible(4, "kjv")));
  });

  it("keys a Strong's entry globally", () => {
    expect(hitKey(strongsEntry("G386"))).toBe("lexicon:G386");
  });
});

describe("mergeHits", () => {
  it("interleaves round-robin across terms and groups, not term after term", () => {
    const merged = mergeHits([
      { term: "resurrection", hits: [[bible(1), bible(2)], [commentary(1, 1)], [], [], []] },
      { term: "raised", hits: [[bible(3), bible(4)], [commentary(2, 12)], [], [], []] },
    ]);
    expect(merged.map((m) => `${m.term}:${hitKey(m.hit)}`)).toEqual([
      "resurrection:bible:web:1Cor:15:1",
      "resurrection:commentary:mhc:1",
      "raised:bible:web:1Cor:15:3",
      "raised:commentary:mhc:2",
      "resurrection:bible:web:1Cor:15:2",
      "raised:bible:web:1Cor:15:4",
    ]);
    expect(merged.map((m) => m.rank)).toEqual([0, 0, 0, 0, 1, 1]);
  });

  it("drops a hit two terms both found, keeping the earlier term's copy", () => {
    const merged = mergeHits([
      { term: "resurrection", hits: [[bible(4)], [], [], [], []] },
      { term: "raised", hits: [[bible(4)], [], [], [], []] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].term).toBe("resurrection");
  });

  it("keeps two commentary works' entry_id 1 as distinct hits", () => {
    const merged = mergeHits([{ term: "t", hits: [[], [commentary(1, 1, "mhc"), commentary(1, 1, "other")], [], [], []] }]);
    expect(merged).toHaveLength(2);
  });

  it(`caps at ${MAX_MERGED_HITS} without starving later terms`, () => {
    const many = (start: number) => Array.from({ length: 5 }, (_, i) => bible(start + i));
    const merged = mergeHits([
      { term: "a", hits: [many(1), [commentary(1, 1)], [dictionary("A")], [book("s1")], [strongsEntry("G1")]] },
      { term: "b", hits: [many(10), [commentary(2, 2)], [dictionary("B")], [book("s2")], [strongsEntry("G2")]] },
      { term: "c", hits: [many(20), [commentary(3, 3)], [dictionary("C")], [book("s3")], [strongsEntry("G3")]] },
      { term: "d", hits: [many(30), [commentary(4, 4)], [dictionary("D")], [book("s4")], [strongsEntry("G4")]] },
    ]);
    expect(merged).toHaveLength(MAX_MERGED_HITS);
    // Rank 0 of all four terms across all five groups is 20 hits; the cap lands inside it,
    // so every term contributed and at least three content types made it in.
    expect(new Set(merged.map((m) => m.term))).toEqual(new Set(["a", "b", "c", "d"]));
    expect(new Set(merged.map((m) => m.hit.kind)).size).toBeGreaterThanOrEqual(3);
  });

  it("returns nothing for no hits", () => {
    expect(mergeHits([{ term: "t", hits: [[], [], [], [], []] }])).toEqual([]);
    expect(mergeHits([])).toEqual([]);
  });
});

describe("mapHit — exhaustive over the six hit kinds", () => {
  const works = [work("web", { type: "bible" }), work("mhc"), work("easton", { type: "dictionary" }), work("bcf1689", { type: "book" })];

  it("maps a bible hit to a single-verse chip, never a whole chapter", () => {
    expect(mapHit(bible(4), works)).toEqual({ chip: { kind: "bible", workId: "web", osis: "1Cor", chapter: 15, verses: "4" } });
  });

  it("maps a Strong's occurrence to the same single-verse bible chip", () => {
    expect(mapHit(strongsOccurrence(4), works)).toEqual({ chip: { kind: "bible", workId: "kjv", osis: "1Cor", chapter: 15, verses: "4" } });
  });

  it("maps a dictionary hit to a headword chip", () => {
    expect(mapHit(dictionary("Resurrection"), works)).toEqual({ chip: { kind: "dictionary", workId: "easton", headword: "Resurrection" } });
  });

  it("maps a Strong's entry to a lexicon chip", () => {
    expect(mapHit(strongsEntry("G386"), works)).toEqual({ chip: { kind: "lexicon", strongId: "G386" } });
  });

  it("maps a commentary hit to a marked, highlight-stripped extra carrying its entry id", () => {
    const mapped = mapHit(commentary(7, 12), works);
    expect("extra" in mapped).toBe(true);
    if (!("extra" in mapped)) return;
    expect(mapped.extra.source).toMatchObject({
      kind: "commentary",
      workId: "mhc",
      label: "MHC — 1Cor 15:12",
      canonicalTarget: { kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15 },
      excerpt: "…raised up…",
      searchExcerpt: true,
    });
    expect(mapped.extra.source).not.toHaveProperty("contentVersion");
    expect(mapped.extra.entryIds).toEqual([7]);
    expect(mapped.extra.requires).toEqual([{ workId: "mhc", policy: "allowed" }]);
  });

  it("labels a chapter introduction without a verse", () => {
    const mapped = mapHit(commentary(1, null), works);
    if (!("extra" in mapped)) throw new Error("expected extra");
    expect(mapped.extra.source.label).toBe("MHC — 1Cor 15");
  });

  it("maps a book hit to a marked extra addressed by section", () => {
    const mapped = mapHit(book("ch31"), works);
    if (!("extra" in mapped)) throw new Error("expected extra");
    expect(mapped.extra.source).toMatchObject({
      kind: "book",
      label: "Chapter 31 · Of the State of Man (BCF1689)",
      canonicalTarget: { kind: "book", workId: "bcf1689", sectionId: "ch31" },
      excerpt: "…the resurrection of the dead…",
      searchExcerpt: true,
    });
    expect(mapped.extra.entryIds).toBeUndefined();
  });

  it("gates an extra as unknown when the work is not in the list, matching the chip path", () => {
    const mapped = mapHit(commentary(1, 1, "missing"), works);
    if (!("extra" in mapped)) throw new Error("expected extra");
    expect(mapped.extra.requires).toEqual([{ workId: "missing", policy: "unknown" }]);
    expect(mapped.extra.source.label).toBe("missing — 1Cor 15:1");
  });

  it("splits a merged list into chips and extras preserving order within each", () => {
    const hits = [bible(1), commentary(1, 1), dictionary("A"), book("s"), strongsEntry("G1"), strongsOccurrence(2)]
      .map((hit) => ({ hit, term: "t", rank: 0 }));
    const { chips, extras } = hitsToContext(hits, works);
    expect(chips.map((c) => c.kind)).toEqual(["bible", "dictionary", "lexicon", "bible"]);
    expect(extras.map((e) => e.source.kind)).toEqual(["commentary", "book"]);
  });
});

describe("searchTerms", () => {
  it("issues one relevance-sorted multi-type search per term with the shared signal, in parallel", async () => {
    const signal = new AbortController().signal;
    searchMock.mockResolvedValue(response([[bible(1)], [], [], [], []]));
    await searchTerms(["resurrection", "raised", "risen"], signal);
    expect(searchMock).toHaveBeenCalledTimes(3);
    for (const [i, term] of ["resurrection", "raised", "risen"].entries()) {
      expect(searchMock).toHaveBeenNthCalledWith(i + 1, term, { sort: "relevance", signal });
    }
    // No types filter (all groups), no limit/offset (multi-type ignores them anyway).
    expect(searchMock.mock.calls[0][1]).not.toHaveProperty("types");
    expect(searchMock.mock.calls[0][1]).not.toHaveProperty("limit");
  });

  it("merges the responses round-robin", async () => {
    searchMock
      .mockResolvedValueOnce(response([[bible(1)], [commentary(1, 1)], [], [], []]))
      .mockResolvedValueOnce(response([[bible(2)], [], [], [], []]));
    const merged = await searchTerms(["a", "b"], new AbortController().signal);
    expect(merged.map((m) => hitKey(m.hit))).toEqual([
      "bible:web:1Cor:15:1",
      "commentary:mhc:1",
      "bible:web:1Cor:15:2",
    ]);
  });

  it("does not start when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchTerms(["a"], controller.signal)).rejects.toMatchObject({ kind: "aborted" });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("maps an abort during the fan-out to aborted, never to network or expansionFailed", async () => {
    const controller = new AbortController();
    searchMock.mockImplementation(
      (_q, opts) =>
        new Promise((_, reject) => {
          opts?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const pending = searchTerms(["a", "b"], controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ kind: "aborted" });
    controller.abort();
    await assertion;
  });

  it("maps any other failure to network, exposing nothing of the underlying error", async () => {
    searchMock.mockRejectedValue(new Error("sqlite: disk I/O error at /srv/content.sqlite"));
    await expect(searchTerms(["a"], new AbortController().signal))
      .rejects.toMatchObject({ kind: "network", message: "A network error occurred." });
  });

  it("is all-or-nothing: one failed term fails the search rather than silently dropping the term", async () => {
    searchMock
      .mockResolvedValueOnce(response([[bible(1)], [], [], [], []]))
      .mockRejectedValueOnce(new Error("boom"));
    await expect(searchTerms(["a", "b"], new AbortController().signal)).rejects.toMatchObject({ kind: "network" });
  });
});
