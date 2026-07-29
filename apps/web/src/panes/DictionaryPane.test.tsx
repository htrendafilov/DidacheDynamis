import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { DictionaryPane } from "./DictionaryPane";

const entry = vi.fn();
vi.mock("../data/hooks", () => ({
  useWorks: () => [
    {
      id: "easton",
      type: "dictionary",
      language: "en",
      title: "Easton's Bible Dictionary",
      abbrev: "EBD",
      direction: "ltr",
      versification: "kjv",
      license: "Public Domain",
      attribution: "Public-domain test fixture.",
      source_url: null,
      source_version: "test",
    },
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
  useDictionaryHeadwords: () => [{ headword: "Aaron" }, { headword: "Moses" }],
  useDictionaryEntry: (workId: string, headword: string | null) => entry(workId, headword),
  useStrongEntry: () => ({ loading: false, notFound: false, error: false, data: null }),
}));

const aaronEntry = {
  work_id: "easton",
  headword: "Aaron",
  body: {
    blocks: [
      {
        kind: "paragraph" as const,
        text: "The eldest son of Amram, brother of MOSES.",
        runs: [
          { t: "The eldest son of Amram, brother of " },
          {
            t: "MOSES",
            dictionary_ref: { work_id: "easton", entry_key: "MOSES", headword: "Moses" },
          },
          { t: "." },
        ],
      },
    ],
  },
};

const mosesEntry = {
  work_id: "easton",
  headword: "Moses",
  body: {
    blocks: [
      {
        kind: "paragraph" as const,
        text: "The brother of AARON.",
        runs: [
          { t: "The brother of " },
          {
            t: "AARON",
            dictionary_ref: { work_id: "easton", entry_key: "AARON", headword: "Aaron" },
          },
          { t: "." },
        ],
      },
    ],
  },
};

function Harness() {
  const pane = useStore((state) => state.panes[0]);
  return <DictionaryPane pane={pane} />;
}

describe("DictionaryPane", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    entry.mockReset();
    useStore.setState({
      panes: [
        { id: "dict-pane", type: "dictionary", workId: "easton", osis: "John", chapter: 3, headword: "Aaron" },
      ],
    });
  });

  it("navigates to an internal dictionary link in the same pane", () => {
    entry.mockReturnValue({ loading: false, error: false, data: aaronEntry });
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Open dictionary entry Moses" }));
    expect(useStore.getState().panes[0]).toMatchObject({
      id: "dict-pane",
      type: "dictionary",
      headword: "Moses",
    });
  });

  it("persists a headword browsed through the local list", () => {
    entry.mockImplementation((_workId: string, headword: string | null) => ({
      loading: false,
      error: false,
      data: headword === "Moses" ? mosesEntry : aaronEntry,
    }));
    render(<Harness />);

    // The selected entry is pane state, so reload restores what the user currently sees.
    fireEvent.click(screen.getByRole("button", { name: "Moses" }));
    expect(screen.getByRole("heading", { name: "Moses" })).toBeInTheDocument();
    expect(useStore.getState().panes[0].headword).toBe("Moses");
    expect(screen.getByRole("searchbox")).toHaveValue("Aa");

    // Internal dictionary links continue to navigate in the same pane.
    fireEvent.click(screen.getByRole("button", { name: "Open dictionary entry Aaron" }));
    expect(screen.getByRole("heading", { name: "Aaron" })).toBeInTheDocument();
  });

  it("shows a localized failure message instead of spinning forever on 404", () => {
    entry.mockReturnValue({ loading: false, error: true, data: null });
    render(<Harness />);

    expect(screen.getByText("This dictionary entry could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("switches to a Strong's lexicon and drops the Easton headword", () => {
    entry.mockReturnValue({ loading: false, error: false, data: aaronEntry });
    render(<Harness />);

    fireEvent.change(screen.getByRole("combobox", { name: "Dictionary source" }), {
      target: { value: "strongsgreek" },
    });

    expect(useStore.getState().panes[0]).toMatchObject({
      workId: "strongsgreek",
      headword: undefined,
    });
    expect(screen.getByRole("searchbox")).toHaveAttribute(
      "placeholder",
      "Strong's number (e.g. H1254 or G3056)…",
    );
  });
});
