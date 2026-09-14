import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CommentaryPassage,
  CrossReferences,
  DictionaryEntry,
  GeneralBook,
  Meta,
  Passage,
  StrongEntry,
  Work,
} from "../data/api";
import { db } from "../data/notes";
import type { Note } from "../data/notes";
import { DEFAULT_CONTEXT_BUDGET, MAX_SOURCES } from "./contextBudget";
import { setLoggingConfirmed } from "./credentials";
import type { ContextChip } from "./types";

vi.mock("../data/api", () => ({
  api: {
    meta: vi.fn(),
    passage: vi.fn(),
    commentary: vi.fn(),
    dictionaryEntry: vi.fn(),
    crossReferences: vi.fn(),
    generalBook: vi.fn(),
  },
}));
vi.mock("../data/hooks", () => ({ strongEntry: vi.fn() }));

import { api } from "../data/api";
import { strongEntry } from "../data/hooks";
import { buildContext, type ExtraCandidate } from "./context";

const apiMock = vi.mocked(api);
const strongEntryMock = vi.mocked(strongEntry);

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id,
    type: "bible",
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

function passage(text: string, verse = 16): Passage {
  return {
    work_id: "web",
    osis: "John",
    chapter: 3,
    headings: [],
    verses: [{ verse, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: text }] }] }],
  };
}

const META: Meta = { content_version: "v1", works: 1 };

beforeEach(async () => {
  vi.clearAllMocks();
  apiMock.meta.mockResolvedValue(META);
  await db.notes.clear();
  setLoggingConfirmed(false);
});

describe("buildContext retrieval", () => {
  it("builds a bible source with a contiguous S1 id", async () => {
    apiMock.passage.mockResolvedValue(passage("For God so loved the world."));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16" }];
    const { sources, dropped } = await buildContext(chips, [work("web")], true, new AbortController().signal);
    expect(dropped).toEqual([]);
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("S1");
    expect(sources[0].excerpt).toBe("16 For God so loved the world.");
    // Includes the retrieved verse, not just book/chapter, so the citation actually
    // focuses verse 16 on click (openPassage's verse param).
    expect(sources[0].canonicalTarget).toEqual({ kind: "bible", workId: "web", osis: "John", chapter: 3, verse: 16 });
  });

  it("targets the first verse actually returned, not the requested range's start, when the start is absent", async () => {
    // apps/api's passage route filters to verses that exist within the requested range
    // (routers/passages.py) — a range beginning at an absent verse (e.g. a gap) still
    // returns later verses. The citation must focus one of those, not verse 14, which
    // this passage does not contain.
    apiMock.passage.mockResolvedValue({
      work_id: "web",
      osis: "John",
      chapter: 3,
      headings: [],
      verses: [
        { verse: 16, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: "For God so loved the world." }] }] },
        { verse: 17, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: "For God sent not his Son." }] }] },
      ],
    });
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "14-17" }];
    const { sources } = await buildContext(chips, [work("web")], true, new AbortController().signal);
    expect(sources[0].canonicalTarget).toEqual({ kind: "bible", workId: "web", osis: "John", chapter: 3, verse: 16 });
  });

  it("assigns contiguous ids after some chips are dropped", async () => {
    apiMock.passage.mockResolvedValue(passage("Text one."));
    apiMock.dictionaryEntry.mockResolvedValue({
      work_id: "easton",
      headword: "Grace",
      body: { blocks: [{ kind: "paragraph", text: "Unmerited favour." }] },
    } as DictionaryEntry);
    const chips: ContextChip[] = [
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16" },
      { kind: "lexicon", strongId: "G9999" }, // strongEntry resolves to null -> dropped
      { kind: "dictionary", workId: "easton", headword: "Grace" },
    ];
    strongEntryMock.mockResolvedValue(null);
    const { sources, dropped } = await buildContext(
      chips,
      [work("web"), work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
    );
    expect(dropped).toEqual([{ label: "Strong's G9999", kind: "lexicon", reason: "unavailable" }]);
    expect(sources.map((s) => s.id)).toEqual(["S1", "S2"]);
  });
});

describe("buildContext licence gate (§11)", () => {
  it("never lets a prohibited work's text into the sources array", async () => {
    apiMock.passage.mockResolvedValue(passage("Restricted text."));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16" }];
    const { sources, dropped } = await buildContext(
      chips,
      [work("web", { ai_context_policy: "prohibited" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toEqual([]);
    expect(JSON.stringify(sources)).not.toContain("Restricted text");
    expect(dropped).toEqual([{ label: "John 3:16 (WEB)", kind: "bible", reason: "licence", detail: "policyBlocked" }]);
  });

  it("treats unknown as never eligible, not a soft state", async () => {
    apiMock.passage.mockResolvedValue(passage("x"));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources } = await buildContext(chips, [work("web", { ai_context_policy: "unknown" })], true, new AbortController().signal);
    expect(sources).toEqual([]);
  });

  it("blocks allowed_no_training when privacy routing is off, with an actionable reason", async () => {
    apiMock.passage.mockResolvedValue(passage("x"));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources, dropped } = await buildContext(
      chips,
      [work("web", { ai_context_policy: "allowed_no_training" })],
      false, // privacyRouting off
      new AbortController().signal,
    );
    expect(sources).toEqual([]);
    expect(dropped[0].detail).toBe("turnOnPrivacyRouting");
  });

  it("blocks allowed_no_training when privacy routing is on but logging is not confirmed", async () => {
    apiMock.passage.mockResolvedValue(passage("x"));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources, dropped } = await buildContext(
      chips,
      [work("web", { ai_context_policy: "allowed_no_training" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toEqual([]);
    expect(dropped[0].detail).toBe("confirmLoggingDisabled");
  });

  it("admits allowed_no_training once privacy routing is on and logging is confirmed", async () => {
    setLoggingConfirmed(true);
    apiMock.passage.mockResolvedValue(passage("x"));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources } = await buildContext(
      chips,
      [work("web", { ai_context_policy: "allowed_no_training" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toHaveLength(1);
  });
});

describe("buildContext budget (§4)", () => {
  it("drops a single source whole, never truncated, when it is over the per-source cap", async () => {
    const huge = "word ".repeat(3000); // far over any offered cap
    apiMock.passage.mockResolvedValue(passage(huge));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources, dropped } = await buildContext(chips, [work("web")], true, new AbortController().signal, {
      perSourceCap: 2000,
      totalBudget: 8000,
    });
    expect(sources).toEqual([]);
    // The estimate travels with the drop so the pre-send summary can name a figure the
    // reader can act on rather than only "too large".
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ label: "John 3 (WEB)", kind: "bible", reason: "over-cap" });
    expect(dropped[0].estimatedTokens).toBeGreaterThan(2000);
  });

  it("admits a source the default cap rejects once the reader raises the limit", async () => {
    // The measured reason the cap became configurable (§4 "Budget calibration"): a whole
    // Matthew Henry chapter runs to ~21,600 tokens, so at 2,000 the commentary could never
    // be sent at all — 937 of its 938 chapters were excluded outright.
    const chapterSized = "word ".repeat(9000); // ~20,600 tokens
    apiMock.commentary.mockResolvedValue({
      work_id: "mhc",
      osis: "Isa",
      chapter: 10,
      entries: [{ entry_id: 1, unit_id: "mhc/John/3/1-1/01", verse_start: 1, verse_end: 4, body: { blocks: [{ kind: "paragraph", text: chapterSized }] } }],
    } as CommentaryPassage);
    const chips: ContextChip[] = [{ kind: "commentary", workId: "mhc", osis: "Isa", chapter: 10 }];
    const works = [work("mhc", { type: "commentary" })];

    const tight = await buildContext(chips, works, true, new AbortController().signal, {
      perSourceCap: 6000,
      totalBudget: 16000,
    });
    expect(tight.sources).toEqual([]);
    expect(tight.dropped[0].reason).toBe("over-cap");

    const generous = await buildContext(chips, works, true, new AbortController().signal, {
      perSourceCap: 25000,
      totalBudget: 32000,
    });
    expect(generous.sources).toHaveLength(1);
    expect(generous.dropped).toEqual([]);
  });

  it("keeps sources in relevance order and drops the remainder once the total budget is spent", async () => {
    // ~1829 tokens each: safely under the 2000/source cap, but four of these already
    // reach the 8000 total, so the lowest-priority chip (dictionary) should lose out even
    // though it was listed first, and budget drops should show up among the bible chips too.
    const big = "word ".repeat(800);
    apiMock.passage.mockResolvedValue(passage(big));
    apiMock.dictionaryEntry.mockResolvedValue({
      work_id: "easton",
      headword: "Grace",
      body: { blocks: [{ kind: "paragraph", text: big }] },
    } as DictionaryEntry);
    const chips: ContextChip[] = [
      { kind: "dictionary", workId: "easton", headword: "Grace" },
      { kind: "bible", workId: "web", osis: "John", chapter: 3 },
      { kind: "bible", workId: "web", osis: "John", chapter: 4 },
      { kind: "bible", workId: "web", osis: "John", chapter: 5 },
      { kind: "bible", workId: "web", osis: "John", chapter: 6 },
      { kind: "bible", workId: "web", osis: "John", chapter: 7 },
      { kind: "bible", workId: "web", osis: "John", chapter: 8 },
    ];
    // Distinct text per chapter: these must be budget drops, not dedup drops. Identical
    // text would (correctly, since dedup now runs first) collapse to a single source and
    // leave the budget with room to spare, which is a different assertion entirely — see
    // "deduplicates before spending the budget" below.
    apiMock.passage.mockImplementation((_w, osis, chapter) =>
      Promise.resolve({ ...passage(`chapter ${chapter} ${big}`), osis, chapter: chapter as number }),
    );
    const { sources, dropped } = await buildContext(
      chips,
      [work("web"), work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
      { perSourceCap: 2000, totalBudget: 8000 },
    );
    expect(sources.every((s) => s.kind === "bible")).toBe(true); // dictionary lost out to bible priority
    expect(dropped.some((d) => d.kind === "dictionary" && d.reason === "budget")).toBe(true);
    const total = sources.reduce((sum, s) => sum + s.estimatedTokens, 0);
    expect(total).toBeLessThanOrEqual(8000);
  });

  it(`caps at ${MAX_SOURCES} sources even when the token budget has room left, reported as "count", never "budget"`, async () => {
    apiMock.dictionaryEntry.mockImplementation((_w, headword) =>
      Promise.resolve({
        work_id: "easton",
        headword: headword as string,
        body: { blocks: [{ kind: "paragraph", text: `Definition of ${headword}.` }] },
      } as DictionaryEntry),
    );
    const chips: ContextChip[] = Array.from({ length: MAX_SOURCES + 3 }, (_, i) => ({
      kind: "dictionary" as const,
      workId: "easton",
      headword: `word${i}`,
    }));
    const { sources, dropped } = await buildContext(
      chips,
      [work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toHaveLength(MAX_SOURCES);
    expect(dropped.filter((d) => d.reason === "count")).toHaveLength(3);
    expect(dropped.filter((d) => d.reason === "budget")).toHaveLength(0);
  });

  it("deduplicates identical excerpts", async () => {
    apiMock.dictionaryEntry.mockResolvedValue({
      work_id: "easton",
      headword: "Grace",
      body: { blocks: [{ kind: "paragraph", text: "Unmerited favour." }] },
    } as DictionaryEntry);
    const chips: ContextChip[] = [
      { kind: "dictionary", workId: "easton", headword: "Grace" },
      { kind: "dictionary", workId: "easton", headword: "Grace" },
    ];
    const { sources, dropped } = await buildContext(
      chips,
      [work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toHaveLength(1);
    expect(dropped).toEqual([{ label: "Grace (EASTON)", kind: "dictionary", reason: "duplicate" }]);
  });

  it("deduplicates before spending the budget, so a duplicate cannot evict a distinct source", async () => {
    // Five copies of one ~1829-token chapter plus one distinct dictionary entry. Budgeting
    // first spends 4 x 1829 on the copies, hits the 8000 ceiling and drops the dictionary —
    // then throws three of those copies away as duplicates anyway, so the turn ends with
    // one chapter and loses the dictionary for nothing.
    const big = "word ".repeat(800);
    apiMock.passage.mockResolvedValue(passage(big));
    apiMock.dictionaryEntry.mockResolvedValue({
      work_id: "easton",
      headword: "Grace",
      body: { blocks: [{ kind: "paragraph", text: "Unmerited favour." }] },
    } as DictionaryEntry);
    const chips: ContextChip[] = [
      ...Array.from({ length: 5 }, () => ({ kind: "bible" as const, workId: "web", osis: "John", chapter: 3 })),
      { kind: "dictionary", workId: "easton", headword: "Grace" },
    ];
    const { sources, dropped } = await buildContext(
      chips,
      [work("web"), work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
    );
    expect(sources.map((s) => s.kind)).toEqual(["bible", "dictionary"]);
    expect(dropped.every((d) => d.reason === "duplicate")).toBe(true);
    expect(dropped).toHaveLength(4);
  });

  it("treats overlapping verse ranges over the same chapter as duplicates", async () => {
    // §4.5 is "same work + overlapping verse range", not "identical target". John 3:16 and
    // John 3:16-18 share verse 16; sending both re-sends it and pays for it twice.
    apiMock.passage.mockImplementation((_w, _osis, _chapter, verses) => {
      const all = [16, 17, 18].map((verse) => ({
        verse,
        lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: `Verse ${verse} text.` }] }],
      }));
      const parts = verses ? verses.split("-") : [];
      const [start, end] = parts.length ? [Number(parts[0]), Number(parts[parts.length - 1])] : [1, 999];
      return Promise.resolve({
        work_id: "web",
        osis: "John",
        chapter: 3,
        headings: [],
        verses: all.filter((v) => v.verse >= start && v.verse <= end),
      } as Passage);
    });
    const chips: ContextChip[] = [
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16" },
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16-18" },
    ];
    const { sources, dropped } = await buildContext(chips, [work("web")], true, new AbortController().signal);
    expect(sources).toHaveLength(1);
    expect(dropped).toEqual([
      { label: "John 3:16-18 (WEB)", kind: "bible", reason: "duplicate" },
    ]);
  });

  it("keeps non-overlapping verse ranges over the same chapter", async () => {
    apiMock.passage.mockImplementation((_w, _osis, _chapter, verses) => {
      const all = [16, 17, 18, 19].map((verse) => ({
        verse,
        lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: `Verse ${verse} text.` }] }],
      }));
      const parts = verses ? verses.split("-") : [];
      const [start, end] = parts.length ? [Number(parts[0]), Number(parts[parts.length - 1])] : [1, 999];
      return Promise.resolve({
        work_id: "web",
        osis: "John",
        chapter: 3,
        headings: [],
        verses: all.filter((v) => v.verse >= start && v.verse <= end),
      } as Passage);
    });
    const chips: ContextChip[] = [
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "16" },
      { kind: "bible", workId: "web", osis: "John", chapter: 3, verses: "18-19" },
    ];
    const { sources, dropped } = await buildContext(chips, [work("web")], true, new AbortController().signal);
    expect(sources).toHaveLength(2);
    expect(dropped).toEqual([]);
  });
});

describe("buildContext cancellation", () => {
  it("throws AbortError and does not call the API when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    await expect(buildContext(chips, [work("web")], true, controller.signal)).rejects.toThrow();
    expect(apiMock.passage).not.toHaveBeenCalled();
  });
});

describe("buildContext note chip", () => {
  it("reads a note from local Dexie, never the API, and applies no licence gate", async () => {
    const note: Note = {
      id: "note-1",
      kind: "passage",
      title: "My note",
      contentHtml: "<p>Some <strong>thoughts</strong>.</p>",
      osis: "John",
      chapter: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.notes.put(note);
    const chips: ContextChip[] = [{ kind: "note", noteId: "note-1" }];
    const { sources } = await buildContext(chips, [], true, new AbortController().signal);
    expect(sources).toHaveLength(1);
    expect(sources[0].excerpt).toBe("Some thoughts.");
    expect(sources[0].excerpt).not.toContain("<");
    expect(apiMock.passage).not.toHaveBeenCalled();
  });
});

describe("buildContext lexicon and xref chips", () => {
  it("builds a lexicon source via strongEntry, not the api client", async () => {
    strongEntryMock.mockResolvedValue({
      strong_id: "G3439",
      language: "grc",
      work_id: "strongsgreek",
      lemma: "μονογενής",
      transliteration: "monogenes",
      pronunciation: null,
      definition: "only-born, i.e. sole.",
      see: [],
    } as StrongEntry);
    const chips: ContextChip[] = [{ kind: "lexicon", strongId: "g3439" }];
    const { sources } = await buildContext(
      chips,
      [work("strongsgreek", { type: "lexicon" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].canonicalTarget).toEqual({ kind: "lexicon", strongId: "G3439" });
    expect(strongEntryMock).toHaveBeenCalledWith("G3439");
  });

  it("requires both the xref work and the preview work to be eligible", async () => {
    const xrefs: CrossReferences = {
      osis: "John",
      chapter: 3,
      verse: 16,
      source_work_id: "tsk",
      references: [
        { target_ref: "Rom.5.8", target_osis: "Rom", target_chapter: 5, target_verse: 8, votes: 1, preview: "For God commends..." },
      ],
    };
    apiMock.crossReferences.mockResolvedValue(xrefs);
    const chips: ContextChip[] = [{ kind: "xref", osis: "John", chapter: 3, verse: 16, previewWork: "web" }];
    const { sources, dropped } = await buildContext(
      chips,
      [work("tsk", { type: "commentary" }), work("web", { ai_context_policy: "prohibited" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toEqual([]);
    expect(dropped[0].reason).toBe("licence");
  });
});

describe("buildContext book chip", () => {
  it("finds a nested section and builds a source from its body", async () => {
    const gb: GeneralBook = {
      work_id: "baptist1689",
      sections: [
        {
          section_id: "chapter-1",
          title: "Chapter 1",
          level: 1,
          body: { blocks: [] },
          children: [
            {
              section_id: "chapter-1.1",
              title: "Chapter 1, Paragraph 1",
              level: 2,
              body: { blocks: [{ kind: "paragraph", text: "The Holy Scripture is sufficient." }] },
              children: [],
            },
          ],
        },
      ],
    };
    apiMock.generalBook.mockResolvedValue(gb);
    const chips: ContextChip[] = [{ kind: "book", workId: "baptist1689", sectionId: "chapter-1.1" }];
    const { sources } = await buildContext(
      chips,
      [work("baptist1689", { type: "book" })],
      true,
      new AbortController().signal,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].excerpt).toBe("The Holy Scripture is sufficient.");
    expect(sources[0].canonicalTarget).toEqual({ kind: "book", workId: "baptist1689", sectionId: "chapter-1.1" });
  });

  // M1 recovered 1,106 chapter introductions, which carry NULL verses. selectCommentaryEntries
  // treats NULL as ±Infinity, so an introduction now enters context for *every* verse of its
  // chapter — including a 1,000-word one. That is intended (an introduction is about the whole
  // chapter), but it must not blow the per-source cap and silently drop the commentary entirely.
  it("includes a chapter introduction for any verse, and still respects the per-source cap", async () => {
    const introduction = "Introductory exposition. ".repeat(400); // ~1,000 words
    vi.mocked(api.commentary).mockResolvedValue({
      work_id: "mhc",
      osis: "John",
      chapter: 3,
      entries: [
        { entry_id: 1, unit_id: "mhc/John/3/intro/01", verse_start: null, verse_end: null, body: { blocks: [{ kind: "paragraph", text: introduction }] } },
        { entry_id: 2, unit_id: "mhc/John/3/16-16/01", verse_start: 16, verse_end: 16, body: { blocks: [{ kind: "paragraph", text: "On verse sixteen." }] } },
      ],
    } as never);

    const chips: ContextChip[] = [
      { kind: "commentary", workId: "mhc", osis: "John", chapter: 3, verse: 16 },
    ];
    const works = [work("mhc", { type: "commentary" })];

    // Cap high enough for both: the introduction must actually be selected for verse 16.
    const roomy = await buildContext(chips, works, true, new AbortController().signal, {
      perSourceCap: 100_000,
      totalBudget: 100_000,
    });
    expect(roomy.sources).toHaveLength(1);
    expect(roomy.sources[0].excerpt).toContain("Introductory exposition");
    expect(roomy.sources[0].excerpt).toContain("On verse sixteen");

    // Cap below the introduction's size: the source is dropped whole and reported, never
    // truncated and never silently missing.
    const tight = await buildContext(chips, works, true, new AbortController().signal, {
      perSourceCap: 200,
      totalBudget: 100_000,
    });
    expect(tight.sources).toHaveLength(0);
    expect(tight.dropped).toHaveLength(1);
    expect(tight.dropped[0].reason).toBe("over-cap");
    expect(tight.dropped[0].estimatedTokens).toBeGreaterThan(200);
  });
});

// M9.4 steps 3/4: pre-built candidates threaded through the same gate, dedupe and budget
// as chips, so an expansion snippet can never bypass what a chip is subject to.
describe("buildContext extraCandidates (M9.4)", () => {
  function extra(overrides: Partial<ExtraCandidate["source"]> = {}, rest: Partial<ExtraCandidate> = {}): ExtraCandidate {
    return {
      source: {
        kind: "commentary",
        workId: "mhc",
        label: "MHC — 1Cor 15:12",
        canonicalTarget: { kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15 },
        language: "en",
        excerpt: "…if Christ be preached that he rose from the dead…",
        estimatedTokens: 20,
        searchExcerpt: true,
        ...overrides,
      },
      requires: [{ workId: "mhc", policy: "allowed" }],
      entryIds: [12],
      ...rest,
    };
  }

  function mhcEntries(...spans: [number, number, number][]) {
    vi.mocked(api.commentary).mockResolvedValue({
      work_id: "mhc",
      osis: "1Cor",
      chapter: 15,
      entries: spans.map(([entry_id, verse_start, verse_end]) => ({
        entry_id,
        unit_id: `mhc/1Cor/15/${verse_start}-${verse_end}/01`,
        verse_start,
        verse_end,
        body: { blocks: [{ kind: "paragraph", text: `Entry ${entry_id} on verses ${verse_start}-${verse_end}.` }] },
      })),
    } as never);
  }

  const works = [work("mhc", { type: "commentary" })];
  const signal = () => new AbortController().signal;

  it("stamps contentVersion from the /meta call it already makes, and keeps the search-excerpt mark", async () => {
    const { sources } = await buildContext([], works, true, signal(), DEFAULT_CONTEXT_BUDGET, [extra()]);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ id: "S1", contentVersion: "v1", searchExcerpt: true });
    expect(apiMock.meta).toHaveBeenCalledTimes(1);
  });

  it("licence-gates an extra exactly like a chip: a prohibited work's snippet never leaves", async () => {
    const restricted = extra({ excerpt: "Restricted snippet text" }, { requires: [{ workId: "mhc", policy: "prohibited" }] });
    const { sources, dropped } = await buildContext([], [work("mhc", { ai_context_policy: "prohibited" })], true, signal(), DEFAULT_CONTEXT_BUDGET, [restricted]);
    expect(sources).toEqual([]);
    expect(dropped).toEqual([expect.objectContaining({ reason: "licence", kind: "commentary" })]);
    expect(JSON.stringify({ sources, dropped })).not.toContain("Restricted snippet text");
  });

  it("gates unknown as prohibited", async () => {
    const { sources } = await buildContext([], works, true, signal(), DEFAULT_CONTEXT_BUDGET, [
      extra({}, { requires: [{ workId: "mhc", policy: "unknown" }] }),
    ]);
    expect(sources).toEqual([]);
  });

  it("keeps a reader's chip for 15:4 and a search excerpt from the 15:12 entry as two sources", async () => {
    mhcEntries([1, 1, 11], [2, 12, 19]);
    const chips: ContextChip[] = [{ kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15, verse: 4 }];
    const { sources, dropped } = await buildContext(chips, works, true, signal(), DEFAULT_CONTEXT_BUDGET, [extra({}, { entryIds: [2] })]);
    expect(dropped).toEqual([]);
    expect(sources.map((s) => [s.id, s.searchExcerpt ?? false])).toEqual([["S1", false], ["S2", true]]);
  });

  it("drops a search excerpt from the entry the chip already fetched in full, and the chip's full text wins", async () => {
    mhcEntries([1, 1, 11], [2, 12, 19]);
    const chips: ContextChip[] = [{ kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15, verse: 4 }];
    const { sources, dropped } = await buildContext(chips, works, true, signal(), DEFAULT_CONTEXT_BUDGET, [extra({}, { entryIds: [1] })]);
    expect(sources).toHaveLength(1);
    expect(sources[0].excerpt).toBe("Entry 1 on verses 1-11.");
    expect(sources[0].searchExcerpt).toBeUndefined();
    expect(dropped).toEqual([expect.objectContaining({ reason: "duplicate", kind: "commentary" })]);
  });

  it("treats a whole-chapter commentary chip as covering every excerpt from that chapter", async () => {
    mhcEntries([1, 1, 11], [2, 12, 19]);
    const chips: ContextChip[] = [{ kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15 }];
    const { sources, dropped } = await buildContext(chips, works, true, signal(), DEFAULT_CONTEXT_BUDGET, [extra({}, { entryIds: [2] })]);
    expect(sources).toHaveLength(1);
    expect(dropped.map((d) => d.reason)).toEqual(["duplicate"]);
  });

  it("does not collapse two extras from different chapters or different works", async () => {
    const { sources } = await buildContext([], [work("mhc", { type: "commentary" }), work("other", { type: "commentary" })], true, signal(), DEFAULT_CONTEXT_BUDGET, [
      extra({}, { entryIds: [1] }),
      extra({ canonicalTarget: { kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 16 }, excerpt: "Chapter sixteen." }, { entryIds: [1] }),
      extra({ workId: "other", canonicalTarget: { kind: "commentary", workId: "other", osis: "1Cor", chapter: 15 }, excerpt: "Another commentary." }, { requires: [{ workId: "other", policy: "allowed" }], entryIds: [1] }),
    ]);
    expect(sources).toHaveLength(3);
  });

  it("ranks extras by kind with chips, ties by insertion, and assigns contiguous ids across both", async () => {
    apiMock.passage.mockResolvedValue(passage("Now is Christ risen from the dead.", 20));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "1Cor", chapter: 15, verses: "20" }];
    const bookExtra: ExtraCandidate = {
      source: {
        kind: "book",
        workId: "bcf1689",
        label: "Chapter 31 (BCF1689)",
        canonicalTarget: { kind: "book", workId: "bcf1689", sectionId: "ch31" },
        language: "en",
        excerpt: "…the bodies of men after death return to dust…",
        estimatedTokens: 15,
        searchExcerpt: true,
      },
      requires: [{ workId: "bcf1689", policy: "allowed" }],
    };
    const allWorks = [work("web"), work("mhc", { type: "commentary" }), work("bcf1689", { type: "book" })];
    // Extras arrive book-then-commentary; KIND_PRIORITY must still put bible, commentary, book.
    const { sources } = await buildContext(chips, allWorks, true, signal(), DEFAULT_CONTEXT_BUDGET, [bookExtra, extra()]);
    expect(sources.map((s) => [s.id, s.kind])).toEqual([["S1", "bible"], ["S2", "commentary"], ["S3", "book"]]);
  });

  it("applies the per-source cap and total budget to extras", async () => {
    const big = extra({ estimatedTokens: 5000, excerpt: "big" }, { entryIds: [1] });
    const small = extra({ estimatedTokens: 10, excerpt: "small", canonicalTarget: { kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 16 } }, { entryIds: [2] });
    const { sources, dropped } = await buildContext([], works, true, signal(), { perSourceCap: 1000, totalBudget: 1000 }, [big, small]);
    expect(sources.map((s) => s.excerpt)).toEqual(["small"]);
    expect(dropped).toEqual([expect.objectContaining({ reason: "over-cap", estimatedTokens: 5000 })]);
  });

  // The top commentary hits take Path A by entry id (§3, live-run revision), each with its
  // snippet as a fallback candidate.
  describe("full-text commentary hits", () => {
    const entryChip: ContextChip = { kind: "commentary", workId: "mhc", osis: "1Cor", chapter: 15, verse: 12, entryId: 2 };

    it("fetches exactly the entry the hit named: verse-filtered at the API, picked by id here", async () => {
      mhcEntries([1, 1, 11], [2, 12, 19]);
      const { sources, dropped } = await buildContext([entryChip], works, true, signal());
      expect(dropped).toEqual([]);
      expect(sources.map((s) => [s.excerpt, s.label, s.searchExcerpt ?? false])).toEqual([
        ["Entry 2 on verses 12-19.", "MHC — 1Cor 15:12", false],
      ]);
      expect(apiMock.commentary).toHaveBeenCalledWith("mhc", "1Cor", 15, 12, expect.anything());
    });

    it("drops the snippet fallback silently when the full entry survives — no duplicate line for the reader", async () => {
      mhcEntries([1, 1, 11], [2, 12, 19]);
      const { sources, dropped } = await buildContext([entryChip], works, true, signal(), DEFAULT_CONTEXT_BUDGET, [
        extra({}, { entryIds: [2], fallback: true }),
      ]);
      expect(sources.map((s) => s.excerpt)).toEqual(["Entry 2 on verses 12-19."]);
      expect(dropped).toEqual([]);
    });

    it("keeps the snippet fallback when the full entry is over the per-source cap, and reports that drop with its cost", async () => {
      mhcEntries([1, 1, 11], [2, 12, 19]);
      const { sources, dropped } = await buildContext([entryChip], works, true, signal(), { perSourceCap: 4, totalBudget: 1000 }, [
        extra({ estimatedTokens: 3 }, { entryIds: [2], fallback: true }),
      ]);
      expect(sources.map((s) => [s.excerpt, s.searchExcerpt ?? false])).toEqual([
        ["…if Christ be preached that he rose from the dead…", true],
      ]);
      expect(dropped).toEqual([expect.objectContaining({ reason: "over-cap", kind: "commentary", label: "MHC — 1Cor 15:12" })]);
    });
  });
});
