import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Verse } from "../data/api";
import { CIRRenderer } from "./CIRRenderer";

const johnVerse: Verse[] = [
  {
    verse: 16,
    lines: [
      {
        kind: "p",
        level: 1,
        para_start: true,
        runs: [{ t: "For God so loved the world", wj: true }, { t: ", that he gave his Son." }],
      },
    ],
  },
];

const psalmVerse: Verse[] = [
  {
    verse: 1,
    lines: [
      { kind: "q", level: 1, para_start: false, runs: [{ t: "The LORD is my shepherd;" }] },
      { kind: "q", level: 2, para_start: false, runs: [{ t: "I shall lack nothing." }] },
    ],
  },
];

describe("CIRRenderer", () => {
  it("marks words of Jesus and shows the red-letter mode", () => {
    const { container } = render(
      <CIRRenderer verses={johnVerse} headings={[]} layout="per-line" wordsOfChrist="red" />,
    );
    expect(container.querySelector(".reader")).toHaveAttribute("data-woc", "red");
    const woj = container.querySelector(".woj");
    expect(woj).toHaveTextContent("For God so loved the world");
    expect(container.querySelector(".vnum")).toHaveTextContent("16");
  });

  it("renders poetry lines with indent levels", () => {
    const { container } = render(
      <CIRRenderer verses={psalmVerse} headings={[]} layout="per-line" wordsOfChrist="off" />,
    );
    expect(container.querySelector(".line.q.q1")).toBeInTheDocument();
    expect(container.querySelector(".line.q.q2")).toBeInTheDocument();
  });

  it("groups prose into a paragraph in flowing mode", () => {
    const { container } = render(
      <CIRRenderer verses={johnVerse} headings={[]} layout="flowing" wordsOfChrist="off" />,
    );
    expect(container.querySelector("p.para")).toBeInTheDocument();
    expect(container.querySelector(".reader")).toHaveAttribute("data-layout", "flowing");
  });

  it("renders section/title headings before the verse", () => {
    const { getByText } = render(
      <CIRRenderer
        verses={psalmVerse}
        headings={[{ before_verse: 1, kind: "title", text: "A Psalm by David." }]}
        layout="per-line"
        wordsOfChrist="off"
      />,
    );
    expect(getByText("A Psalm by David.")).toBeInTheDocument();
  });
});
