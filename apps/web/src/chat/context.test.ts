import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
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
  it("drops a single source whole, never truncated, when it is over the 2000-token cap", async () => {
    const huge = "word ".repeat(3000); // far over 2000 tokens at any divisor
    apiMock.passage.mockResolvedValue(passage(huge));
    const chips: ContextChip[] = [{ kind: "bible", workId: "web", osis: "John", chapter: 3 }];
    const { sources, dropped } = await buildContext(chips, [work("web")], true, new AbortController().signal);
    expect(sources).toEqual([]);
    expect(dropped).toEqual([{ label: "John 3 (WEB)", kind: "bible", reason: "over-cap" }]);
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
    apiMock.passage.mockImplementation((_w, osis, chapter) =>
      Promise.resolve({ ...passage(big), osis, chapter: chapter as number }),
    );
    const { sources, dropped } = await buildContext(
      chips,
      [work("web"), work("easton", { type: "dictionary" })],
      true,
      new AbortController().signal,
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
});
