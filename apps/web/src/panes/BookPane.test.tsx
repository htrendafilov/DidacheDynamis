import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { BookPane } from "./BookPane";

vi.mock("../data/hooks", () => ({
  useWorks: () => [
    {
      id: "baptist1689",
      type: "book",
      language: "en",
      title: "The Baptist Confession of Faith of 1689",
      abbrev: "1689",
      direction: "ltr",
      versification: "none",
      license: "Public Domain",
      attribution: "Public-domain test fixture.",
      source_url: null,
      source_version: "test",
    },
  ],
  useGeneralBook: () => ({
    loading: false,
    error: false,
    data: {
      work_id: "baptist1689",
      sections: [
        {
          section_id: "chapter-1",
          title: "Chapter 1",
          level: 1,
          body: { blocks: [{ kind: "paragraph", text: "The Scriptures are sufficient." }] },
          children: [],
        },
        {
          section_id: "chapter-2",
          title: "Chapter 2",
          level: 1,
          body: { blocks: [{ kind: "paragraph", text: "The Lord our God is one God." }] },
          children: [],
        },
      ],
    },
  }),
}));

function Harness() {
  const pane = useStore((state) => state.panes[0]);
  return <BookPane pane={pane} />;
}

describe("BookPane", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useStore.setState({
      panes: [
        {
          id: "book-pane",
          type: "book",
          workId: "baptist1689",
          osis: "John",
          chapter: 3,
        },
      ],
    });
  });

  it("renders a TOC and switches the visible section", () => {
    render(<Harness />);
    expect(screen.getByRole("navigation", { name: "Table of contents" })).toBeVisible();
    expect(screen.getByText("The Scriptures are sufficient.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Chapter 2" }));
    expect(screen.getByText("The Lord our God is one God.")).toBeVisible();
    expect(useStore.getState().panes[0].sectionId).toBe("chapter-2");
  });
});
