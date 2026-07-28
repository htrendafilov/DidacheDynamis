import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api, type StrongEntry, type Work } from "../data/api";
import { clearStrongEntryCache, clearWorksCache } from "../data/hooks";
import i18n from "../i18n";
import { useStore } from "../state/store";
import { DictionaryPane } from "./DictionaryPane";

const strongsGreek: Work = {
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
};

const g2316: StrongEntry = {
  strong_id: "G2316",
  language: "grc",
  work_id: "strongsgreek",
  lemma: "θεός",
  transliteration: "theos",
  pronunciation: "theh-os'",
  definition: "a deity; God.",
  see: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Harness() {
  const pane = useStore((state) => state.panes[0]);
  return <DictionaryPane pane={pane} />;
}

describe("DictionaryPane work discovery", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.restoreAllMocks();
    clearWorksCache();
    clearStrongEntryCache();
    useStore.setState({
      panes: [
        {
          id: "lex-pane",
          type: "dictionary",
          workId: "strongsgreek",
          osis: "John",
          chapter: 1,
          headword: "G2316",
        },
      ],
    });
  });

  it("waits for the work type before choosing an endpoint family", async () => {
    const works = deferred<Work[]>();
    vi.spyOn(api, "works").mockReturnValue(works.promise);
    const dictionaryHeadwords = vi.spyOn(api, "dictionaryHeadwords").mockResolvedValue([]);
    const dictionaryEntry = vi.spyOn(api, "dictionaryEntry");
    const lexiconEntry = vi.spyOn(api, "lexiconEntry").mockResolvedValue(g2316);

    render(<Harness />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(dictionaryHeadwords).not.toHaveBeenCalled();
    expect(dictionaryEntry).not.toHaveBeenCalled();
    expect(lexiconEntry).not.toHaveBeenCalled();

    await act(async () => works.resolve([strongsGreek]));

    expect(await screen.findByRole("heading", { name: "G2316 · θεός" })).toBeInTheDocument();
    expect(dictionaryHeadwords).not.toHaveBeenCalled();
    expect(dictionaryEntry).not.toHaveBeenCalled();
    expect(lexiconEntry).toHaveBeenCalledWith("G2316");
  });
});
