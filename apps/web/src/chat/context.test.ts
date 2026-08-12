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
import { buildContext } from "./context";

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

  it("caps at 12 sources even when the token budget has room left", async () => {
    apiMock.dictionaryEntry.mockImplementation((_w, headword) =>
      Promise.resolve({
        work_id: "easton",
        headword: headword as string,
        body: { blocks: [{ kind: "paragraph", text: `Definition of ${headword}.` }] },
      } as DictionaryEntry),
    );
    const chips: ContextChip[] = Array.from({ length: 15 }, (_, i) => ({
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
    expect(sources).toHaveLength(12);
    expect(dropped.filter((d) => d.reason === "budget")).toHaveLength(3);
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
