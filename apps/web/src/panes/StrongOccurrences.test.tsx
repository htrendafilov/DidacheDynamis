import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StrongOccurrenceResponse } from "../data/api";
import i18n from "../i18n";
import { useStore } from "../state/store";
import { StrongOccurrences } from "./StrongOccurrences";

const occurrences = vi.fn();
vi.mock("../data/api", () => ({
  api: {
    strongOccurrences: (...args: unknown[]) => occurrences(...args),
  },
}));
vi.mock("../data/hooks", () => ({
  useStrongSources: () => [{ work_id: "kjv" }],
  useWorks: () => [
    { id: "kjv", type: "bible", abbrev: "KJV", title: "King James Version" },
  ],
  useBooks: () => [
    { osis: "Gen", name: "Genesis", order: 1, chapter_count: 50 },
    { osis: "John", name: "John", order: 43, chapter_count: 21 },
  ],
}));

const first: StrongOccurrenceResponse = {
  strong_id: "G3588",
  total: 2,
  occurrence_total: 5,
  offset: 0,
  limit: 50,
  has_more: true,
  available_works: ["kjv"],
  hits: [
    {
      kind: "strongs_occurrence",
      work_id: "kjv",
      title: "Genesis 1:1",
      snippet: "In the beginning God created the heaven and the earth.",
      strong_id: "G3588",
      osis: "Gen",
      chapter: 1,
      verse: 1,
      ref: "Gen.1.1",
      surfaces: ["the", "the"],
      occurrence_count: 2,
      morphology: [{ scheme: "robinson", code: "T-NSM" }],
    },
  ],
};

const second: StrongOccurrenceResponse = {
  ...first,
  offset: 1,
  has_more: false,
  hits: [
    {
      ...first.hits[0],
      title: "John 1:1",
      osis: "John",
      ref: "John.1.1",
      snippet: "In the beginning was the Word.",
      surfaces: ["the Word"],
      occurrence_count: 3,
    },
  ],
};

describe("StrongOccurrences", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    occurrences.mockReset();
    occurrences.mockImplementation(
      (_strongId: string, options: { offset?: number }) =>
        Promise.resolve(options.offset ? second : first),
    );
    useStore.setState({
      panes: [
        {
          id: "lex",
          type: "dictionary",
          workId: "strongsgreek",
          osis: "John",
          chapter: 1,
          headword: "G3588",
        },
        {
          id: "commentary",
          type: "commentary",
          workId: "mhc",
          osis: "John",
          chapter: 1,
        },
        {
          id: "book",
          type: "book",
          workId: "baptist1689",
          osis: "John",
          chapter: 1,
        },
      ],
      settings: {
        ...useStore.getState().settings,
        strongs: "off",
      },
    });
  });

  it("shows totals, groups repeated uses, and loads every page", async () => {
    render(<StrongOccurrences strongId="G3588" preservePaneId="lex" />);

    expect(
      await screen.findByText("5 occurrences in 2 verses"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Sources")).not.toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("the · the")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load 50 more/ }));
    expect(await screen.findByText("John 1:1")).toBeInTheDocument();
    expect(occurrences).toHaveBeenLastCalledWith(
      "G3588",
      expect.objectContaining({ offset: 1 }),
    );
  });

  it("filters canon/books and opens a highlighted Bible occurrence without replacing the dictionary", async () => {
    render(<StrongOccurrences strongId="G3588" preservePaneId="lex" />);
    await screen.findByText("Genesis 1:1");

    fireEvent.change(screen.getByLabelText("Testament"), {
      target: { value: "nt" },
    });
    fireEvent.change(screen.getByLabelText("Bible books"), {
      target: { value: "John" },
    });
    await waitFor(() =>
      expect(occurrences).toHaveBeenLastCalledWith(
        "G3588",
        expect.objectContaining({ canon: "nt", books: "John", works: "kjv" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Genesis 1:1/ }));
    const state = useStore.getState();
    expect(state.settings.strongs).toBe("on");
    expect(state.panes.find((pane) => pane.id === "lex")).toMatchObject({
      type: "dictionary",
      headword: "G3588",
    });
    expect(state.panes.find((pane) => pane.type === "bible")).toMatchObject({
      workId: "kjv",
      osis: "Gen",
      chapter: 1,
      focusVerse: 1,
      focusStrong: "G3588",
    });
  });
});
