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
      settings: { ...useStore.getState().settings, bookMode: "paged" },
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

  it("orders the source, book, and contents controls in the pane header", () => {
    render(<Harness />);
    const source = screen.getByRole("combobox", { name: "Source" });
    const book = screen.getByRole("combobox", { name: "Book" });
    const contents = screen.getByRole("button", { name: /Hide contents/ });

    expect(source.compareDocumentPosition(book) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(book.compareDocumentPosition(contents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    useStore.setState({
      settings: { ...useStore.getState().settings, bookMode: "scroll" },
    });
    render(<Harness />);
    expect(screen.getByText("The Scriptures are sufficient.")).toBeVisible();
    expect(screen.getByText("The Lord our God is one God.")).toBeVisible();
    expect(document.querySelectorAll(".book-scroll-section")).toHaveLength(2);
    expect(useStore.getState().settings.bookMode).toBe("scroll");
  });

  it("scroll-spy tracks the section nearest the top of the viewport", () => {
    // jsdom has no layout, so simulate geometry: the content box is 400px tall at top 0
    // (detection line at 25% = 100px); each section is 300px tall and moves up as we scroll.
    let scrollTop = 0;
    const naturalTop = (element: HTMLElement) => {
      if (element.classList.contains("book-content")) return 0;
      if (element.textContent?.includes("Scriptures")) return 0;
      if (element.textContent?.includes("one God")) return 300;
      return 0;
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const top = this.classList.contains("book-content")
        ? 0
        : naturalTop(this) - scrollTop;
      return { top, y: top } as DOMRect;
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    try {
      useStore.setState({
        settings: { ...useStore.getState().settings, bookMode: "scroll" },
      });
      render(<Harness />);
      // Not scrolled: the first section owns the top of the viewport.
      expect(useStore.getState().panes[0].sectionId).toBe("chapter-1");

      // Scroll far enough that the second section crosses the detection line.
      scrollTop = 250;
      const content = document.querySelector(".book-content") as HTMLElement;
      fireEvent.scroll(content);
      expect(useStore.getState().panes[0].sectionId).toBe("chapter-2");
    } finally {
      vi.restoreAllMocks();
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });
});
