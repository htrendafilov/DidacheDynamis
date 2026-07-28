import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchHit } from "../data/api";
import i18n from "../i18n";
import { rememberSearch, saveSearchHistory } from "../search/history";
import { useStore } from "../state/store";
import { SearchPanel } from "./SearchPanel";

const search = vi.fn();
vi.mock("../data/api", () => ({ api: { search: (...args: unknown[]) => search(...args) } }));

vi.mock("../data/hooks", () => ({
  useBooks: () => [
    { osis: "Gen", name: "Genesis", order: 1, chapter_count: 50 },
    { osis: "Exod", name: "Exodus", order: 2, chapter_count: 40 },
    { osis: "Matt", name: "Matthew", order: 40, chapter_count: 28 },
  ],
  useStrongSources: () => [{ work_id: "web" }],
  useWorks: () => [
    { id: "web", abbrev: "WEB", type: "bible", title: "World English Bible" },
    { id: "mhc", abbrev: "MHC", type: "commentary", title: "Matthew Henry" },
    { id: "easton", abbrev: "EBD", type: "dictionary", title: "Easton's" },
    { id: "baptist1689", abbrev: "1689", type: "book", title: "1689 Confession" },
    { id: "strongsgreek", abbrev: "StrGrk", type: "lexicon", title: "Strong's Greek" },
    { id: "tsk", abbrev: "TSK", type: "xref", title: "Treasury of Scripture Knowledge" },
  ],
}));

const gen: SearchHit = {
  kind: "bible",
  work_id: "web",
  title: "Gen 1:1",
  snippet: "the <b>earth</b>",
  osis: "Gen",
  chapter: 1,
  verse: 1,
  ref: "Gen.1.1",
};
const exod: SearchHit = { ...gen, title: "Exod 1:1", osis: "Exod", ref: "Exod.1.1" };
const commentary: SearchHit = {
  kind: "commentary",
  work_id: "mhc",
  title: "John 3:16",
  snippet: "<b>love</b>",
  osis: "John",
  chapter: 3,
  verse_start: 16,
  entry_id: 5,
};
const dict: SearchHit = {
  kind: "dictionary",
  work_id: "easton",
  title: "Grace",
  snippet: "<b>grace</b>",
  headword: "Grace",
};
const book: SearchHit = {
  kind: "book",
  work_id: "baptist1689",
  title: "Chapter 1 › 1",
  snippet: "<b>scripture</b>",
  section_id: "chapter-1-scripture.1",
};
const strongEntry: SearchHit = {
  kind: "strongs_entry",
  work_id: "strongsgreek",
  title: "G1722 · ἐν",
  snippet: "a primary preposition denoting position",
  strong_id: "G1722",
  language: "grc",
  lemma: "ἐν",
  transliteration: "en",
  occurrence_count: 12,
  verse_count: 10,
};
const strongOccurrence: SearchHit = {
  kind: "strongs_occurrence",
  work_id: "web",
  title: "John 1:1",
  snippet: "In the beginning was the Word.",
  strong_id: "G1722",
  osis: "John",
  chapter: 1,
  verse: 1,
  ref: "John.1.1",
  surfaces: ["In"],
  occurrence_count: 1,
  morphology: [{ scheme: "robinson", code: "PREP" }],
};

function group(type: string, hits: SearchHit[], total = hits.length, has_more = false) {
  return { type, total, offset: 0, limit: 50, has_more, hits };
}

// Preview response for a multi-type "All" query: Bible has 2 total but 1 previewed.
const allRes = () => ({
  query: "q",
  sort: "relevance",
  total: 5,
  groups: [
    group("bible", [gen], 2, true),
    group("commentary", [commentary]),
    group("dictionary", [dict]),
    group("book", [book]),
  ],
});

describe("SearchPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    search.mockReset();
    useStore.setState({
      panes: [{ id: "a", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    });
  });

  async function runSearch(props: Partial<ComponentProps<typeof SearchPanel>> = {}) {
    render(<SearchPanel mode="docked" onClose={() => {}} {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Search the text…"), {
      target: { value: "earth" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
    });
  }

  it("lists only work types supported by the current search providers", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    fireEvent.click(screen.getByText("Sources"));

    expect(screen.getByText("World English Bible")).toBeInTheDocument();
    expect(screen.queryByText("Strong's Greek")).not.toBeInTheDocument();
    expect(screen.queryByText("Treasury of Scripture Knowledge")).not.toBeInTheDocument();
  });

  it("stays open on desktop (docked) and flags the verse to flash", async () => {
    search.mockResolvedValue(allRes());
    const onClose = vi.fn();
    await runSearch({ mode: "docked", onClose });

    fireEvent.click(await screen.findByRole("button", { name: /Genesis 1:1/ }));
    expect(useStore.getState().panes.find((p) => p.type === "bible")).toMatchObject({
      osis: "Gen",
      chapter: 1,
      focusVerse: 1,
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on mobile (fullscreen) after opening a result", async () => {
    search.mockResolvedValue(allRes());
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    await runSearch({ mode: "fullscreen", onNavigate, onClose });

    fireEvent.click(await screen.findByRole("button", { name: /Genesis 1:1/ }));
    expect(onNavigate).toHaveBeenCalledWith("bible");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows grouped tabs with counts and a preview of each type", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();

    expect(await screen.findByRole("tab", { name: "All 5" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Bible 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Commentary 1" })).toBeInTheDocument();
    // Each group previews in the All view (Bible book name is localized).
    expect(screen.getByText("Genesis 1:1")).toBeInTheDocument();
    expect(screen.getByText("Grace")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1 › 1")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("earth", { sort: "relevance", canon: undefined, works: undefined });
  });

  it("opens a group tab, paginates it, and appends without duplicates", async () => {
    search.mockImplementation((_q: string, opts: { types?: string; offset?: number } = {}) => {
      if (opts.types !== "bible") return Promise.resolve(allRes());
      const page = opts.offset ? [exod] : [gen];
      return Promise.resolve({
        query: "q",
        sort: "relevance",
        total: 2,
        groups: [group("bible", page, 2, !opts.offset)],
      });
    });

    await runSearch();
    fireEvent.click(await screen.findByRole("tab", { name: "Bible 2" }));

    expect(await screen.findByText("1–1 of 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Load 50 more/ }));
    await waitFor(() => expect(screen.getByText("1–2 of 2")).toBeInTheDocument());
    expect(screen.getByText("Exodus 1:1")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 more results loaded; 2 of 2 shown.",
    );
    expect(screen.queryByRole("button", { name: /Load 50 more/ })).not.toBeInTheDocument();
  });

  it("announces loading, counts, and a recoverable search error", async () => {
    let resolve: ((value: ReturnType<typeof allRes>) => void) | undefined;
    search.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await runSearch();
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    resolve?.(allRes());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("5 results loaded."),
    );

    search.mockRejectedValueOnce(new Error("offline"));
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Search could not be completed"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Search could not be completed");
    expect(screen.queryByRole("button", { name: /Genesis 1:1/ })).not.toBeInTheDocument();
  });

  it("runs the dedicated Strong's mode with Bible text and exact morphology", async () => {
    search.mockResolvedValue({
      query: "G1722",
      sort: "canonical",
      total: 1,
      groups: [group("strongs", [strongOccurrence])],
    });
    const onNavigate = vi.fn();
    render(
      <SearchPanel
        mode="docked"
        onNavigate={onNavigate}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Strong's" }));
    fireEvent.change(
      screen.getByPlaceholderText(
        "Strong's number, lemma, transliteration, or definition…",
      ),
      { target: { value: "G1722" } },
    );
    fireEvent.change(screen.getByLabelText("Bible text"), {
      target: { value: "beginning" },
    });
    fireEvent.click(screen.getByText("Advanced lexical filters"));
    fireEvent.change(screen.getByLabelText("Morphology scheme"), {
      target: { value: "robinson" },
    });
    fireEvent.change(screen.getByLabelText("Morphology code"), {
      target: { value: "PREP" },
    });
    await act(async () => {
      fireEvent.submit(
        screen.getByRole("button", { name: "Search" }).closest("form")!,
      );
    });

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        "G1722",
        expect.objectContaining({
          types: "strongs",
          verseText: "beginning",
          morphScheme: "robinson",
          morph: "PREP",
          sort: "canonical",
        }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: /John 1:1/ }));
    expect(useStore.getState().settings.strongs).toBe("on");
    expect(useStore.getState().panes[0]).toMatchObject({
      osis: "John",
      chapter: 1,
      focusVerse: 1,
      focusStrong: "G1722",
    });
    expect(onNavigate).toHaveBeenCalledWith("bible");
  });

  it("opens a Strong's lexical card in the Dictionary pane", async () => {
    search.mockResolvedValue({
      query: "en",
      sort: "relevance",
      total: 1,
      groups: [group("strongs", [strongEntry])],
    });
    render(<SearchPanel mode="docked" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Strong's" }));
    fireEvent.change(
      screen.getByPlaceholderText(
        "Strong's number, lemma, transliteration, or definition…",
      ),
      { target: { value: "en" } },
    );
    await act(async () => {
      fireEvent.submit(
        screen.getByRole("button", { name: "Search" }).closest("form")!,
      );
    });

    expect(await screen.findByText("12 occurrences in 10 verses")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /G1722 · ἐν/ }));
    expect(useStore.getState().panes.find((pane) => pane.type === "dictionary")).toMatchObject({
      workId: "strongsgreek",
      headword: "G1722",
    });
  });

  it("re-queries with the testament filter", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    await screen.findByRole("tab", { name: "All 5" });

    fireEvent.click(screen.getByRole("button", { name: "New Testament" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith("earth", {
        sort: "relevance",
        canon: "nt",
        works: undefined,
      }),
    );
  });

  it("filters by individual Bible books and removes the filter from its chip", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    await screen.findByRole("tab", { name: "All 5" });

    fireEvent.click(screen.getByText("Bible books"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Genesis" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        "earth",
        expect.objectContaining({ books: "Gen" }),
      ),
    );

    const chip = screen.getByRole("button", { name: "Remove filter Genesis" });
    expect(chip).toBeInTheDocument();
    fireEvent.click(chip);
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        "earth",
        expect.objectContaining({ books: undefined }),
      ),
    );
  });

  it("refines the complete result set on the server and exposes a removable chip", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    await screen.findByRole("tab", { name: "All 5" });

    const refine = screen.getByPlaceholderText("Refine these results…");
    fireEvent.change(refine, { target: { value: "created" } });
    fireEvent.submit(refine.closest("form")!);
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        "earth",
        expect.objectContaining({ refine: "created" }),
      ),
    );

    const chip = screen.getByRole("button", {
      name: "Remove filter Refine: created",
    });
    fireEvent.click(chip);
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        "earth",
        expect.objectContaining({ refine: undefined }),
      ),
    );
  });

  it("restores query, refinement, filters, ordering, and group from history", async () => {
    saveSearchHistory(
      rememberSearch(
        [],
        {
          query: "earth",
          refine: "created",
          verseText: "",
          morphScheme: "",
          morph: "",
          sort: "canonical",
          canon: "nt",
          works: ["web"],
          books: ["Gen"],
          selected: "bible",
        },
        10,
      ),
    );
    search.mockResolvedValue({
      query: "earth",
      refine: "created",
      sort: "canonical",
      total: 1,
      groups: [group("bible", [gen])],
    });

    render(<SearchPanel mode="docked" onClose={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Run search earth again" }),
    );

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith("earth", {
        sort: "canonical",
        refine: "created",
        canon: "nt",
        works: "web",
        books: "Gen",
        types: "bible",
        offset: 0,
      }),
    );
    expect(screen.getByPlaceholderText("Search the text…")).toHaveValue("earth");
    expect(screen.getByPlaceholderText("Refine these results…")).toHaveValue(
      "created",
    );
    expect(screen.getByRole("button", { name: "New Testament" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "Genesis" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /WEB/ })).toBeChecked();
    expect(screen.getByRole("tab", { name: "Bible 1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("presents filters in a dismissible full-screen sheet on mobile", async () => {
    search.mockResolvedValue(allRes());
    await runSearch({ mode: "fullscreen" });
    await screen.findByRole("tab", { name: "All 5" });

    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    const dialog = screen.getByRole("dialog", { name: "Filters" });
    expect(dialog).toBeInTheDocument();
    const closeFilters = screen.getByRole("button", { name: "Close filters" });
    expect(closeFilters).toHaveFocus();
    screen.getByRole("searchbox", { name: "Search query" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeFilters).toHaveFocus();
    const lastVisibleControl = screen.getByText("Bible books").closest("summary")!;
    lastVisibleControl.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(closeFilters).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "New Testament" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        "earth",
        expect.objectContaining({ canon: "nt" }),
      ),
    );
    expect(screen.getByRole("button", { name: "Remove filter New Testament" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Filters/ })).toHaveFocus());
  });

  it("uses roving keyboard focus for result tabs", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    const allTab = await screen.findByRole("tab", { name: "All 5" });
    const bibleTab = screen.getByRole("tab", { name: "Bible 2" });
    allTab.focus();
    fireEvent.keyDown(allTab, { key: "ArrowRight" });

    await waitFor(() => expect(bibleTab).toHaveFocus());
    expect(bibleTab).toHaveAttribute("aria-selected", "true");
    expect(allTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "search-tab-bible",
    );
  });

  it("keeps the All tab focused when a keyboard-selected query returns no groups", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();
    const bibleTab = await screen.findByRole("tab", { name: "Bible 2" });
    fireEvent.click(bibleTab);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    search.mockResolvedValueOnce({
      query: "earth",
      sort: "relevance",
      total: 0,
      groups: [
        group("bible", []),
        group("commentary", []),
        group("dictionary", []),
        group("book", []),
      ],
    });
    bibleTab.focus();
    fireEvent.keyDown(bibleTab, { key: "ArrowLeft" });

    const allTab = screen.getByRole("tab", { name: /All/ });
    await waitFor(() => expect(allTab).toHaveFocus());
    expect(allTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(allTab).toHaveAccessibleName("All 0"));
  });

  it("restores focus to the last opened result when returning on mobile", async () => {
    search.mockResolvedValue(allRes());
    const onClose = vi.fn();
    const view = render(
      <SearchPanel mode="fullscreen" open onClose={onClose} restoreResultFocus={false} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Search the text…"), {
      target: { value: "earth" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
    const result = await screen.findByRole("button", { name: /Genesis 1:1/ });
    fireEvent.click(result);
    expect(onClose).toHaveBeenCalledOnce();

    view.rerender(
      <SearchPanel
        mode="fullscreen"
        open={false}
        onClose={onClose}
        restoreResultFocus
      />,
    );
    view.rerender(
      <SearchPanel mode="fullscreen" open onClose={onClose} restoreResultFocus />,
    );
    await waitFor(() => expect(result).toHaveFocus());
  });

  it("navigates each result type to the right pane", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();

    fireEvent.click(await screen.findByRole("button", { name: /Chapter 1 › 1/ }));
    expect(useStore.getState().panes.find((p) => p.type === "book")).toMatchObject({
      workId: "baptist1689",
      sectionId: "chapter-1-scripture.1",
    });
  });

  it("navigates a dictionary result to a dictionary pane", async () => {
    search.mockResolvedValue(allRes());
    await runSearch();

    fireEvent.click(await screen.findByRole("button", { name: /Grace/ }));
    expect(useStore.getState().panes.find((p) => p.type === "dictionary")).toMatchObject({
      workId: "easton",
      headword: "Grace",
    });
  });

  it("shows no results when every group is empty", async () => {
    search.mockResolvedValue({
      query: "q",
      sort: "relevance",
      total: 0,
      groups: [group("bible", []), group("commentary", []), group("dictionary", []), group("book", [])],
    });
    await runSearch();
    await waitFor(() => expect(screen.getByText("No results.")).toBeInTheDocument());
  });
});
