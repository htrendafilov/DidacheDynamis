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
  useWorks: () => [],
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

const passage = (osis: string, chapter: number): PassageState => ({
  loading: false,
  error: false,
  data: {
    work_id: "web",
    osis,
    chapter,
    headings: [],
    verses: [
      {
        verse: 1,
        lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: `${osis} ${chapter}:1` }] }],
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
});
