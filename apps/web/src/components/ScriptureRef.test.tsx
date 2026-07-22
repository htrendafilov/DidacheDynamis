import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import { useStore } from "../state/store";
import { ScriptureRef, parseScriptureRef } from "./ScriptureRef";

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

  it("rejects malformed or empty refs", () => {
    for (const bad of ["", "garbage", "John.3", "John.0.1", "John.3.5-3"]) {
      expect(parseScriptureRef(bad)).toBeNull();
    }
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
