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
    expect(screen.queryByText("The Lord our God is one God.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chapter 2" }));
    expect(screen.getByText("The Lord our God is one God.")).toBeVisible();
    expect(useStore.getState().panes[0].sectionId).toBe("chapter-2");
  });

  it("shows and hides the table of contents", () => {
    render(<Harness />);
    const toc = screen.getByRole("navigation", { name: "Table of contents" });
    fireEvent.click(screen.getByRole("button", { name: /Hide contents/ }));
    expect(toc).not.toBeVisible();
    expect(useStore.getState().panes[0].bookTocOpen).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Show contents/ }));
    expect(toc).toBeVisible();
  });

  it("turns sections as pages with previous and next controls", () => {
    render(<Harness />);
    expect(screen.getByText("1 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("The Lord our God is one God.")).toBeVisible();
    expect(screen.getByText("2 of 2")).toBeVisible();
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();
  });

  it("renders every section in continuous scroll mode", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Scroll" }));
    expect(screen.getByText("The Scriptures are sufficient.")).toBeVisible();
    expect(screen.getByText("The Lord our God is one God.")).toBeVisible();
    expect(document.querySelectorAll(".book-scroll-section")).toHaveLength(2);
    expect(useStore.getState().panes[0].bookMode).toBe("scroll");
  });
});
