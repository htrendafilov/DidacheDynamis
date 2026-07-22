import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
      target: { value: "scripture" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
  }

  it("runs both searches and groups Bible and Book results", async () => {
    search.mockResolvedValue({
      hits: [
        { work_id: "web", ref: "John.3.16", osis: "John", chapter: 3, verse: 16, snippet: "loved" },
      ],
    });
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
    expect(screen.getByText("Books")).toBeInTheDocument();
    expect(screen.getByText("Chapter 1. Scripture › 1")).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith("scripture");
    expect(searchBooks).toHaveBeenCalledWith("scripture");
  });

  it("opens the searched section in a book pane on click", async () => {
    search.mockResolvedValue({ hits: [] });
    searchBooks.mockResolvedValue({
      hits: [
        {
          work_id: "baptist1689",
          section_id: "chapter-2-god",
          title: "Chapter 2. God",
          snippet: "one <b>God</b>",
        },
      ],
    });

    await runSearch();
    fireEvent.click(await screen.findByRole("button", { name: /Chapter 2\. God/ }));

    const bookPane = useStore.getState().panes.find((p) => p.type === "book");
    expect(bookPane).toMatchObject({ workId: "baptist1689", sectionId: "chapter-2-god" });
  });

  it("shows no-results only when both searches are empty", async () => {
    search.mockResolvedValue({ hits: [] });
    searchBooks.mockResolvedValue({ hits: [] });

    await runSearch();
    await waitFor(() => expect(screen.getByText("No results.")).toBeInTheDocument());
  });
});
