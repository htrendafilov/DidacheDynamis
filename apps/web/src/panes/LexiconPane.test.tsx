import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import type { StrongEntry } from "../data/api";
import { useStore } from "../state/store";
import { DictionaryPane } from "./DictionaryPane";

const entry = vi.fn();
vi.mock("../data/hooks", () => ({
  useWorks: () => [
    {
      id: "strongsgreek",
      type: "lexicon",
      language: "grc",
      title: "Strong's Greek Dictionary",
      abbrev: "StrGrk",
      direction: "ltr",
      versification: "none",
      license: "Public Domain",
      attribution: "Public-domain test fixture.",
      source_url: null,
      source_version: "test",
    },
  ],
  useStrongEntry: (strongId: string | null) => entry(strongId),
  useDictionaryHeadwords: () => [],
  useDictionaryEntry: () => ({ loading: false, error: false, data: null }),
}));

const g0001: StrongEntry = {
  strong_id: "G0001",
  language: "grc",
  work_id: "strongsgreek",
  lemma: "ἄλφα",
  transliteration: "a",
  pronunciation: "al'-fah",
  definition: "of Hebrew origin; the first letter of the alphabet.",
  see: ["G0427", "G0260"],
};

function Harness() {
  const pane = useStore((state) => state.panes[0]);
  return <DictionaryPane pane={pane} />;
}

describe("LexiconPane (Strong's dictionary work)", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    entry.mockReset();
    useStore.setState({
      panes: [
        {
          id: "lex-pane",
          type: "dictionary",
          workId: "strongsgreek",
          osis: "John",
          chapter: 3,
          headword: "G0001",
        },
      ],
    });
  });

  it("renders the entry with transliteration, pronunciation, definition, and see links", () => {
    entry.mockReturnValue({ loading: false, notFound: false, error: false, data: g0001 });
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "G0001 · ἄλφα" })).toBeInTheDocument();
    expect(screen.getByText("Transliteration")).toBeInTheDocument();
    expect(screen.getByText("al'-fah")).toBeInTheDocument();
    expect(
      screen.getByText("of Hebrew origin; the first letter of the alphabet."),
    ).toBeInTheDocument();
    expect(entry).toHaveBeenCalledWith("G0001");
  });

  it("navigates see-also links inside the same pane", () => {
    entry.mockReturnValue({ loading: false, notFound: false, error: false, data: g0001 });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open Strong's entry G0427" }));
    expect(useStore.getState().panes[0]).toMatchObject({ id: "lex-pane", headword: "G0427" });
  });

  it("normalizes a typed Strong's number and navigates to it", () => {
    entry.mockReturnValue({ loading: false, notFound: false, error: false, data: g0001 });
    render(<Harness />);

    fireEvent.change(screen.getByRole("searchbox", { name: "Find a word…" }), {
      target: { value: "g1722" },
    });
    expect(useStore.getState().panes[0]).toMatchObject({ id: "lex-pane", headword: "G1722" });
  });

  it("keeps the draft exactly as typed across per-keystroke navigations", () => {
    entry.mockReturnValue({ loading: false, notFound: false, error: false, data: g0001 });
    render(<Harness />);
    const input = screen.getByRole("searchbox", { name: "Find a word…" });

    // Each valid prefix navigates (g1 -> G0001, g17 -> G0017, …); the input must keep the
    // user's own text instead of being rewritten to the normalized headword mid-typing.
    for (const value of ["g", "g1", "g17", "g172", "g1722"]) {
      fireEvent.change(input, { target: { value } });
      expect(input).toHaveValue(value);
    }
    expect(useStore.getState().panes[0]).toMatchObject({ id: "lex-pane", headword: "G1722" });
  });

  it("shows a clean miss for a valid id with no entry", () => {
    entry.mockReturnValue({ loading: false, notFound: true, error: false, data: null });
    render(<Harness />);

    expect(screen.getByText("No lexicon entry for this identifier.")).toBeInTheDocument();
  });
});
