import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Document } from "../data/api";
import "../i18n";
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
});
