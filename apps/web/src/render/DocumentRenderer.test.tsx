import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Document } from "../data/api";
import i18n from "../i18n";
import { DocumentRenderer } from "./DocumentRenderer";

const commentary: Document = {
  blocks: [
    { kind: "heading", text: "God's Love." },
    {
      kind: "quotation",
      text: "16 For God so loved the world.",
      runs: [
        { t: "16", superscript: true },
        { t: " For God so loved the world." },
      ],
    },
    {
      kind: "paragraph",
      text: "The gift shows divine love.",
      runs: [
        { t: "The gift shows " },
        { t: "divine love", emphasis: true },
        { t: "." },
      ],
    },
  ],
};

describe("DocumentRenderer", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("visually separates the quoted KJV passage from the commentary", () => {
    const { container } = render(<DocumentRenderer document={commentary} />);

    expect(screen.getByText("Scripture quoted in the commentary · KJV")).toBeInTheDocument();
    expect(screen.getByText("Matthew Henry's commentary")).toBeInTheDocument();
    expect(container.querySelector("blockquote.study-quotation")).toHaveTextContent(
      "For God so loved the world.",
    );
    expect(container.querySelector("sup.study-verse-number")).toHaveTextContent("16");
    expect(container.querySelector("em")).toHaveTextContent("divine love");
  });

  const dictionaryDoc: Document = {
    blocks: [
      {
        kind: "paragraph",
        text: "He met MOSES at the mount (Ex. 4:14).",
        runs: [
          { t: "He met " },
          {
            t: "MOSES",
            dictionary_ref: { work_id: "easton", entry_key: "MOSES", headword: "Moses" },
          },
          { t: " at the mount (" },
          { t: "Ex. 4:14", ref: "Exod.4.14" },
          { t: ")." },
        ],
      },
    ],
  };

  it("renders scripture and dictionary reference controls without nesting buttons", () => {
    const onDictionaryNavigate = vi.fn();
    const { container } = render(
      <DocumentRenderer document={dictionaryDoc} onDictionaryNavigate={onDictionaryNavigate} />,
    );

    const dictButton = screen.getByRole("button", { name: "Open dictionary entry Moses" });
    expect(dictButton).toHaveTextContent("MOSES");
    expect(screen.getByRole("button", { name: "Ex. 4:14" })).toBeInTheDocument();
    expect(container.querySelector("button button")).not.toBeInTheDocument();

    fireEvent.click(dictButton);
    expect(onDictionaryNavigate).toHaveBeenCalledWith({
      work_id: "easton",
      entry_key: "MOSES",
      headword: "Moses",
    });
  });

  it("renders dictionary_ref runs as plain text without a navigation callback", () => {
    const { container } = render(<DocumentRenderer document={dictionaryDoc} />);
    expect(container.querySelector("p")).toHaveTextContent("MOSES");
    expect(screen.queryByRole("button", { name: /Moses/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ex. 4:14" })).toBeInTheDocument();
  });
});
