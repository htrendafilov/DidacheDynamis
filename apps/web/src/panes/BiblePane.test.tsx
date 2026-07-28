import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PassageState } from "../data/hooks";
import i18n from "../i18n";
import { useStore, type Pane } from "../state/store";
import { BiblePane } from "./BiblePane";

let passageState: PassageState;

vi.mock("../data/hooks", () => ({
  useBooks: () => [
    { osis: "Gen", name: "Genesis", order: 1, chapter_count: 50 },
    { osis: "John", name: "John", order: 43, chapter_count: 21 },
  ],
  useWorks: () => [{ id: "strongsgreek", type: "lexicon" }],
  usePassage: () => passageState,
  useCrossReferences: () => null,
}));

const pane: Pane = {
  id: "bible",
  type: "bible",
  workId: "web",
  osis: "Gen",
  chapter: 1,
  focusVerse: 1,
};

const passage = (
  osis: string,
  chapter: number,
  workId = "web",
  lemma = false,
): PassageState => ({
  loading: false,
  error: false,
  data: {
    work_id: workId,
    osis,
    chapter,
    headings: [],
    verses: [
      {
        verse: 1,
        lines: [
          {
            kind: "p",
            level: 1,
            para_start: true,
            runs: [
              {
                t: `${osis} ${chapter}:1`,
                ...(lemma ? { lemma: [{ id: "G1722" }] } : {}),
              },
            ],
          },
        ],
      },
    ],
  },
});

describe("BiblePane search focus", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    passageState = passage("John", 3);
    useStore.setState({ panes: [pane] });
  });

  it("waits for the requested passage before consuming and flashing its verse", () => {
    const { container, rerender } = render(<BiblePane pane={pane} />);

    expect(useStore.getState().panes[0].focusVerse).toBe(1);
    expect(container.querySelector('[data-verse="1"]')).not.toHaveClass("verse-flash");

    passageState = passage("Gen", 1);
    rerender(<BiblePane pane={pane} />);

    expect(useStore.getState().panes[0].focusVerse).toBeUndefined();
    expect(container.querySelector('[data-verse="1"]')).toHaveClass("verse-flash");
  });

  it("enables Strong's and flashes the exact matching translated span", () => {
    const lexicalPane: Pane = {
      ...pane,
      workId: "kjv",
      focusStrong: "G1722",
    };
    passageState = passage("Gen", 1, "kjv", true);
    useStore.setState({
      panes: [lexicalPane],
      settings: { ...useStore.getState().settings, strongs: "on" },
    });

    const { container } = render(<BiblePane pane={lexicalPane} />);

    expect(useStore.getState().panes[0].focusStrong).toBeUndefined();
    expect(container.querySelector('[data-strong-ids="G1722"]')).toHaveClass(
      "strongs-flash",
    );
    expect(container.querySelector('[data-verse="1"]')).not.toHaveClass(
      "verse-flash",
    );
  });

  it("consumes focusStrong even when the target verse is not in the rendered passage", () => {
    const lexicalPane: Pane = {
      ...pane,
      workId: "kjv",
      focusVerse: 2, // the fixture passage only renders verse 1
      focusStrong: "G1722",
    };
    passageState = passage("Gen", 1, "kjv", true);
    useStore.setState({
      panes: [lexicalPane],
      settings: { ...useStore.getState().settings, strongs: "on" },
    });

    render(<BiblePane pane={lexicalPane} />);

    // A retained flag would pin the mobile shell to this pane on every later pane change.
    expect(useStore.getState().panes[0].focusStrong).toBeUndefined();
    expect(useStore.getState().panes[0].focusVerse).toBeUndefined();
  });

  it("consumes focusStrong when the passage request fails and no data ever arrives", () => {
    const lexicalPane: Pane = {
      ...pane,
      workId: "kjv",
      focusStrong: "G1722",
    };
    passageState = { loading: false, error: true, data: null };
    useStore.setState({
      panes: [lexicalPane],
      settings: { ...useStore.getState().settings, strongs: "on" },
    });

    render(<BiblePane pane={lexicalPane} />);

    expect(useStore.getState().panes[0].focusStrong).toBeUndefined();
    expect(useStore.getState().panes[0].focusVerse).toBeUndefined();
  });
});
