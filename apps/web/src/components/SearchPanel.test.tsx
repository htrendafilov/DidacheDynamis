import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchHit } from "../data/api";
import i18n from "../i18n";
import { useStore } from "../state/store";
import { SearchPanel } from "./SearchPanel";

const search = vi.fn();
vi.mock("../data/api", () => ({ api: { search: (...args: unknown[]) => search(...args) } }));

vi.mock("../data/hooks", () => ({
  useWorks: () => [
    { id: "web", abbrev: "WEB", type: "bible", title: "World English Bible" },
    { id: "mhc", abbrev: "MHC", type: "commentary", title: "Matthew Henry" },
    { id: "easton", abbrev: "EBD", type: "dictionary", title: "Easton's" },
    { id: "baptist1689", abbrev: "1689", type: "book", title: "1689 Confession" },
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
    search.mockReset();
    useStore.setState({
      panes: [{ id: "a", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    });
  });

  async function runSearch(props: Partial<ComponentProps<typeof SearchPanel>> = {}) {
    render(<SearchPanel onClose={() => {}} {...props} />);
    fireEvent.change(screen.getByPlaceholderText("Search the text…"), {
      target: { value: "earth" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Search" }).closest("form")!);
  }

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
    await runSearch({ mode: "fullscreen", onClose });

    fireEvent.click(await screen.findByRole("button", { name: /Genesis 1:1/ }));
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
    expect(screen.queryByRole("button", { name: /Load 50 more/ })).not.toBeInTheDocument();
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
