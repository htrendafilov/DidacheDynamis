import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { api, type StrongEntry, type Verse } from "../data/api";
import { clearStrongEntryCache } from "../data/hooks";
import { useStore } from "../state/store";
import { CIRRenderer } from "./CIRRenderer";

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

const h1254: StrongEntry = {
  strong_id: "H1254",
  language: "hbo",
  work_id: "strongshebrew",
  lemma: "bara'",
  transliteration: null,
  pronunciation: "baw-raw'",
  definition: "to create.",
  see: [],
};

const verse: Verse[] = [
  {
    verse: 1,
    lines: [
      {
        kind: "p",
        level: 1,
        para_start: true,
        runs: [
          { t: "God", wj: true, lemma: [{ id: "G2316" }] },
          { t: " " },
          {
            t: "created",
            lemma: [{ id: "H0853" }, { id: "H1254", s: "strongMorph", m: "TH8804" }],
          },
        ],
      },
    ],
  },
];

function renderReader() {
  return render(
    <CIRRenderer
      verses={verse}
      headings={[]}
      layout="per-line"
      wordsOfChrist="red"
      strongsEnabled
    />,
  );
}

describe("StrongsPopover", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    clearStrongEntryCache();
    vi.restoreAllMocks();
    useStore.setState({
      panes: [{ id: "b1", type: "bible", workId: "kjv", osis: "Gen", chapter: 1 }],
    });
  });

  it("opens on hover, shows the entry, and hands off to a Dictionary pane", async () => {
    vi.spyOn(api, "lexiconEntry").mockResolvedValue(g2316);
    renderReader();
    fireEvent.mouseOver(screen.getByRole("button", { name: "God" }));

    const popover = await screen.findByRole("group", { name: "G2316" });
    expect(popover).toHaveTextContent("θεός");
    expect(popover).toHaveTextContent("theos · theh-os'");
    expect(popover).toHaveTextContent("a deity; God.");

    fireEvent.click(screen.getByRole("button", { name: "Open in Dictionary pane" }));
    const dictionaryPane = useStore.getState().panes.find((p) => p.type === "dictionary");
    expect(dictionaryPane).toMatchObject({
      workId: "strongsgreek",
      headword: "G2316",
    });
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "G2316" })).not.toBeInTheDocument(),
    );
  });

  it("shows every id of a multi-id word with occurrence morphology", async () => {
    vi.spyOn(api, "lexiconEntry").mockImplementation((id: string) =>
      id === "H1254" ? Promise.resolve(h1254) : Promise.reject(new Error("404 not found")),
    );
    renderReader();
    fireEvent.mouseOver(screen.getByRole("button", { name: "created" }));

    const popover = await screen.findByRole("group", { name: "H0853, H1254" });
    // H0853 has no fixture entry: clean miss, not an error.
    expect(popover).toHaveTextContent("No lexicon entry for this identifier.");
    expect(popover).toHaveTextContent("bara'");
    expect(popover).toHaveTextContent("Morphology (strongMorph): TH8804");
  });

  it("closes on Escape", async () => {
    vi.spyOn(api, "lexiconEntry").mockResolvedValue(g2316);
    const { container } = renderReader();
    fireEvent.mouseOver(screen.getByRole("button", { name: "God" }));
    await screen.findByRole("group", { name: "G2316" });

    fireEvent.keyDown(container.querySelector(".reader")!, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "G2316" })).not.toBeInTheDocument();
  });

  it("opens for keyboard users on focus and closes when focus leaves", async () => {
    vi.spyOn(api, "lexiconEntry").mockResolvedValue(g2316);
    const { container } = renderReader();
    fireEvent.focus(screen.getByRole("button", { name: "God" }));
    await screen.findByRole("group", { name: "G2316" });

    fireEvent.blur(screen.getByRole("button", { name: "God" }), { relatedTarget: null });
    expect(screen.queryByRole("group", { name: "G2316" })).not.toBeInTheDocument();
    expect(container.querySelector(".strongs-popover")).not.toBeInTheDocument();
  });
});
