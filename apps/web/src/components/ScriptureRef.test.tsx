import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import {
  ScriptureRef,
  calculatePopoverPosition,
  parseScriptureRef,
} from "./ScriptureRef";

const passage = vi.fn();
vi.mock("../data/api", () => ({ api: { passage: (...args: unknown[]) => passage(...args) } }));

describe("parseScriptureRef", () => {
  it("parses single verses, ranges, and numbered books", () => {
    expect(parseScriptureRef("John.3.16")).toEqual({
      osis: "John",
      chapter: 3,
      start: 16,
      end: 16,
    });
    expect(parseScriptureRef("John.3.1-19")).toEqual({
      osis: "John",
      chapter: 3,
      start: 1,
      end: 19,
    });
    expect(parseScriptureRef("2Tim.3.16")).toMatchObject({ osis: "2Tim", start: 16 });
  });

  it("parses chapter-only refs without fabricating a verse", () => {
    expect(parseScriptureRef("Num.12")).toEqual({
      osis: "Num",
      chapter: 12,
      start: null,
      end: null,
    });
  });

  it("rejects malformed or empty refs", () => {
    for (const bad of ["", "garbage", "John.0", "John.0.1", "John.3.5-3"]) {
      expect(parseScriptureRef(bad)).toBeNull();
    }
  });
});

describe("calculatePopoverPosition", () => {
  const boundary = {
    top: 8,
    right: 492,
    bottom: 392,
    left: 108,
    width: 384,
    height: 384,
  };

  it("shifts a preview left at the pane's right edge", () => {
    const position = calculatePopoverPosition(
      { top: 80, right: 490, bottom: 100, left: 460, width: 30, height: 20 },
      boundary,
      { top: 0, right: 220, bottom: 100, left: 0, width: 220, height: 100 },
    );

    expect(position).toMatchObject({ left: 272, top: 100, placement: "below" });
    expect(position.left + 220).toBeLessThanOrEqual(boundary.right);
  });

  it("flips a preview above a citation near the pane footer", () => {
    const position = calculatePopoverPosition(
      { top: 360, right: 300, bottom: 380, left: 270, width: 30, height: 20 },
      boundary,
      { top: 0, right: 220, bottom: 120, left: 0, width: 220, height: 120 },
    );

    expect(position).toMatchObject({ top: 240, placement: "above" });
    expect(position.top).toBeGreaterThanOrEqual(boundary.top);
  });

  it("constrains both dimensions in a narrow, short viewport", () => {
    const narrow = {
      top: 8,
      right: 312,
      bottom: 312,
      left: 8,
      width: 304,
      height: 304,
    };
    const position = calculatePopoverPosition(
      { top: 145, right: 305, bottom: 165, left: 285, width: 20, height: 20 },
      narrow,
      { top: 0, right: 352, bottom: 500, left: 0, width: 352, height: 500 },
    );

    expect(position).toMatchObject({
      left: 8,
      top: 165,
      maxWidth: 304,
      maxHeight: 147,
      placement: "below",
    });
  });
});

describe("ScriptureRef pop-up", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    passage.mockReset();
    useStore.setState({
      panes: [{ id: "b", type: "bible", workId: "web", osis: "Ps", chapter: 23 }],
    });
  });

  it("fetches and shows the passage on open, then opens it in the Bible pane", async () => {
    passage.mockResolvedValue({
      work_id: "web",
      osis: "John",
      chapter: 3,
      verses: [{ verse: 16, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: "For God so loved the world." }] }] }],
      headings: [],
    });

    render(
      <ScriptureRef refValue="John.3.16">
        <sup>John 3:16</sup>
      </ScriptureRef>,
    );

    fireEvent.click(screen.getByRole("button", { name: "John 3:16" }));
    expect(passage).toHaveBeenCalledWith("web", "John", 3, "16");
    expect(await screen.findByText(/For God so loved the world\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open in Bible pane" }));
    const biblePane = useStore.getState().panes.find((p) => p.type === "bible");
    expect(biblePane).toMatchObject({ osis: "John", chapter: 3 });
  });

  it("applies pane-aware coordinates near the right edge and footer", async () => {
    passage.mockResolvedValue({
      work_id: "web",
      osis: "John",
      chapter: 3,
      verses: [{ verse: 16, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: "Preview." }] }] }],
      headings: [],
    });
    const geometry = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("pane-body")) {
          return {
            top: 0,
            right: 500,
            bottom: 400,
            left: 100,
            width: 400,
            height: 400,
          } as DOMRect;
        }
        if (this.classList.contains("scripture-ref")) {
          return {
            top: 360,
            right: 490,
            bottom: 380,
            left: 460,
            width: 30,
            height: 20,
          } as DOMRect;
        }
        if (this.classList.contains("scripture-ref-popover")) {
          return {
            top: 0,
            right: 220,
            bottom: 120,
            left: 0,
            width: 220,
            height: 120,
          } as DOMRect;
        }
        return {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: 0,
          height: 0,
        } as DOMRect;
      });

    try {
      render(
        <div className="pane-body">
          <ScriptureRef refValue="John.3.16">John 3:16</ScriptureRef>
        </div>,
      );
      fireEvent.click(screen.getByRole("button", { name: "John 3:16" }));
      const popover = await screen.findByRole("group", { name: "John 3:16" });

      await waitFor(() => {
        expect(popover).toHaveStyle({
          visibility: "visible",
          top: "240px",
          left: "272px",
          maxWidth: "384px",
          maxHeight: "352px",
        });
      });
      expect(popover).toHaveAttribute("data-placement", "above");
    } finally {
      geometry.mockRestore();
    }
  });

  it("previews a chapter-only ref from a bounded verse window and labels it without :1", async () => {
    passage.mockResolvedValue({
      work_id: "web",
      osis: "Num",
      chapter: 12,
      verses: [{ verse: 1, lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: "And Miriam and Aaron spake against Moses." }] }] }],
      headings: [],
    });

    render(<ScriptureRef refValue="Num.12">Num. 12</ScriptureRef>);

    fireEvent.click(screen.getByRole("button", { name: "Num. 12" }));
    // Never the whole chapter: Psalm 119 would be 176 verses behind a hover.
    expect(passage).toHaveBeenCalledWith("web", "Num", 12, "1-6");
    expect(await screen.findByText(/And Miriam and Aaron spake/)).toBeInTheDocument();
    expect(screen.getByText("Numbers 12")).toBeInTheDocument();
  });

  it("marks a chapter preview as truncated when the window came back full", async () => {
    passage.mockResolvedValue({
      work_id: "web",
      osis: "Num",
      chapter: 12,
      verses: Array.from({ length: 6 }, (_unused, index) => ({
        verse: index + 1,
        lines: [{ kind: "p", level: 1, para_start: true, runs: [{ t: `Verse ${index + 1}.` }] }],
      })),
      headings: [],
    });

    render(<ScriptureRef refValue="Num.12">Num. 12</ScriptureRef>);

    fireEvent.click(screen.getByRole("button", { name: "Num. 12" }));
    expect(await screen.findByText(/Verse 6\.\s…$/)).toBeInTheDocument();
  });

  it("does not refetch a preview while the first request is still in flight", async () => {
    let resolve: ((value: unknown) => void) | undefined;
    passage.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const { rerender } = render(<ScriptureRef refValue="John.3.16">ref</ScriptureRef>);
    fireEvent.click(screen.getByRole("button", { name: "ref" }));
    // Re-render while loading: an unmemoized parseScriptureRef would hand the effect a new
    // object identity each time and issue a duplicate request.
    rerender(<ScriptureRef refValue="John.3.16">ref</ScriptureRef>);
    rerender(<ScriptureRef refValue="John.3.16">ref</ScriptureRef>);
    expect(passage).toHaveBeenCalledTimes(1);

    resolve?.({ work_id: "web", osis: "John", chapter: 3, verses: [], headings: [] });
    await waitFor(() => expect(passage).toHaveBeenCalledTimes(1));
  });

  it("closes on Escape", async () => {
    passage.mockResolvedValue({ work_id: "web", osis: "John", chapter: 3, verses: [], headings: [] });
    render(<ScriptureRef refValue="John.3.16">ref</ScriptureRef>);
    const trigger = screen.getByRole("button", { name: "ref" });
    fireEvent.click(trigger);
    await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders an unparseable ref as plain text with no control", () => {
    render(<ScriptureRef refValue="not-a-ref">plain</ScriptureRef>);
    expect(screen.getByText("plain")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
