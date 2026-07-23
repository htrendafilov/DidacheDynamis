import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchHit } from "../data/api";
import i18n from "../i18n";
import { useStore } from "../state/store";
import { SearchPanel } from "./SearchPanel";

const search = vi.fn();
const searchBooks = vi.fn();

vi.mock("../data/api", () => ({
  api: {
    search: (...args: unknown[]) => search(...args),
    searchBooks: (...args: unknown[]) => searchBooks(...args),
  },
}));

vi.mock("../data/hooks", () => ({
  useWorks: () => [
    { id: "web", abbrev: "WEB", type: "bible" },
    { id: "baptist1689", abbrev: "1689", type: "book" },
  ],
}));

function bibleHit(ref: string, verse: number): SearchHit {
  const [osis, chapter] = ref.split(".");
  return {
    kind: "bible",
    work_id: "web",
    title: `${osis} ${chapter}:${verse}`,
    snippet: "the <b>earth</b>",
    osis,
    chapter: Number(chapter),
    verse,
    ref,
  };
}

function bibleRes(hits: SearchHit[], total = hits.length, hasMore = false) {
  return {
    query: "q",
    sort: "relevance",
    total,
    groups: [{ type: "bible", total, offset: 0, limit: 50, has_more: hasMore, hits }],
  };
}

const noBooks = { hits: [] };

describe("SearchPanel", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    search.mockReset();
    searchBooks.mockReset();
    useStore.setState({
      panes: [{ id: "a", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    });
  });

  async function runSearch() {
    render(<SearchPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search the text…"), {
      target: { value: "earth" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
  }

  it("runs the grouped search and shows Bible and Book groups with a count", async () => {
    search.mockResolvedValue(bibleRes([bibleHit("John.3", 16)], 1));
    searchBooks.mockResolvedValue({
      hits: [
        {
          work_id: "baptist1689",
          section_id: "chapter-1-scripture.1",
          title: "Chapter 1. Scripture › 1",
          snippet: "the Holy <b>Scripture</b>",
        },
      ],
    });

    await runSearch();

    expect(await screen.findByText("Bible")).toBeInTheDocument();
    expect(screen.getByText("1–1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Books")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1. Scripture › 1")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("earth", { sort: "relevance", limit: 50, offset: 0 });
  });

  it("loads more Bible hits without duplicating and updates the count", async () => {
    search
      .mockResolvedValueOnce(bibleRes([bibleHit("Gen.1", 1)], 2, true))
      .mockResolvedValueOnce(bibleRes([bibleHit("John.3", 16)], 2, false));
    searchBooks.mockResolvedValue(noBooks);

    await runSearch();
    expect(await screen.findByText("1–1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load 50 more/ }));

    await waitFor(() => expect(screen.getByText("1–2 of 2")).toBeInTheDocument());
    expect(search).toHaveBeenLastCalledWith("earth", { sort: "relevance", limit: 50, offset: 1 });
    expect(screen.queryByRole("button", { name: /Load 50 more/ })).not.toBeInTheDocument();
  });

  it("re-queries canonically when the sort is switched", async () => {
    search.mockResolvedValue(bibleRes([bibleHit("John.3", 16)], 1));
    searchBooks.mockResolvedValue(noBooks);

    await runSearch();
    await screen.findByText("Bible");

    fireEvent.click(screen.getByRole("button", { name: "Canonical" }));
    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith("earth", {
        sort: "canonical",
        limit: 50,
        offset: 0,
      }),
    );
  });

  it("opens a Bible result in a Bible pane on click", async () => {
    search.mockResolvedValue(bibleRes([bibleHit("Gen.1", 1)], 1));
    searchBooks.mockResolvedValue(noBooks);

    await runSearch();
    fireEvent.click(await screen.findByRole("button", { name: /Genesis 1:1/ }));

    const biblePane = useStore.getState().panes.find((p) => p.type === "bible");
    expect(biblePane).toMatchObject({ osis: "Gen", chapter: 1 });
  });

  it("shows no-results only when both searches are empty", async () => {
    search.mockResolvedValue(bibleRes([]));
    searchBooks.mockResolvedValue(noBooks);

    await runSearch();
    await waitFor(() => expect(screen.getByText("No results.")).toBeInTheDocument());
  });
});
