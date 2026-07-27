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

// Gen 1:1 shape with lexical data (M8.3): tagged spans carry lemma, whitespace does not.
const strongsVerse: Verse[] = [
  {
    verse: 1,
    lines: [
      {
        kind: "p",
        level: 1,
        para_start: true,
        runs: [
          { t: "In the beginning", lemma: [{ id: "H7225" }] },
          { t: " " },
          { t: "God", lemma: [{ id: "H0430" }] },
          { t: " " },
          {
            t: "created",
            lemma: [{ id: "H0853" }, { id: "H1254", s: "strongMorph", m: "TH8804" }],
          },
        ],
      },
    ],
  },
  {
    verse: 2,
    lines: [
      {
        kind: "p",
        level: 1,
        para_start: false,
        runs: [{ t: "For God", wj: true, lemma: [{ id: "G2316" }] }],
      },
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

  it("exposes the bold words-of-Christ mode to the stylesheet", () => {
    const { container } = render(
      <CIRRenderer verses={johnVerse} headings={[]} layout="per-line" wordsOfChrist="bold" />,
    );
    expect(container.querySelector(".reader")).toHaveAttribute("data-woc", "bold");
    expect(container.querySelector(".woj")).toHaveTextContent("For God so loved the world");
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

  it("anchors verses with data-verse so search results can scroll to them", () => {
    const perLine = render(
      <CIRRenderer verses={johnVerse} headings={[]} layout="per-line" wordsOfChrist="off" />,
    );
    expect(perLine.container.querySelector('[data-verse="16"]')).toBeInTheDocument();
    const flowing = render(
      <CIRRenderer verses={johnVerse} headings={[]} layout="flowing" wordsOfChrist="off" />,
    );
    expect(flowing.container.querySelector('[data-verse="16"]')).toBeInTheDocument();
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

  it("leaves the DOM untouched when Strong's mode is off", () => {
    const withoutProp = render(
      <CIRRenderer verses={strongsVerse} headings={[]} layout="per-line" wordsOfChrist="off" />,
    );
    const explicitOff = render(
      <CIRRenderer
        verses={strongsVerse}
        headings={[]}
        layout="per-line"
        wordsOfChrist="off"
        strongsEnabled={false}
      />,
    );
    expect(withoutProp.container.querySelector(".reader")!.innerHTML).toBe(
      explicitOff.container.querySelector(".reader")!.innerHTML,
    );
    // No buttons, no data attributes, no popover: tagged runs are plain spans as before M8.3.
    expect(withoutProp.container.querySelector("[data-strongs]")).not.toBeInTheDocument();
    expect(withoutProp.container.querySelector(".reader button.strongs-word")).toBeNull();
    expect(withoutProp.container.querySelector(".strongs-popover")).not.toBeInTheDocument();
  });

  it("renders tagged runs as delegated buttons when Strong's mode is on", () => {
    const { container } = render(
      <CIRRenderer
        verses={strongsVerse}
        headings={[]}
        layout="per-line"
        wordsOfChrist="red"
        strongsEnabled
      />,
    );
    const words = container.querySelectorAll(".strongs-word");
    expect(words).toHaveLength(4);
    expect(words[0]).toHaveTextContent("In the beginning");
    expect(words[0]).toHaveAttribute("data-strongs", "0");
    // Untagged whitespace runs stay plain spans.
    const plainSpans = container.querySelectorAll(".verse-block .line > span");
    expect(plainSpans[0].textContent).toBe(" ");
    expect(plainSpans[0]).not.toHaveClass("strongs-word");
    // Words-of-Christ styling composes with the Strong's affordance on the same run.
    const jesus = words[3];
    expect(jesus).toHaveTextContent("For God");
    expect(jesus).toHaveClass("woj");
  });

  it("keeps data-verse anchors with Strong's mode on in both layouts", () => {
    for (const layout of ["per-line", "flowing"] as const) {
      const { container, unmount } = render(
        <CIRRenderer
          verses={strongsVerse}
          headings={[]}
          layout={layout}
          wordsOfChrist="off"
          strongsEnabled
        />,
      );
      expect(container.querySelector('[data-verse="1"]')).toBeInTheDocument();
      expect(container.querySelector('[data-verse="2"]')).toBeInTheDocument();
      unmount();
    }
  });

  it("renders a Psalm-119-scale chapter of plain elements with one delegated handler set", () => {
    // ~850 tagged spans: the long-chapter budget the plan calls out. Elements must stay
    // plain buttons; interaction lives on the container, so no per-word handlers exist.
    const big: Verse[] = Array.from({ length: 176 }, (_, verse) => ({
      verse: verse + 1,
      lines: [
        {
          kind: "p" as const,
          level: 1,
          para_start: verse === 0,
          runs: Array.from({ length: 10 }, (_, word) =>
            word % 2 === 0
              ? { t: `w${word}`, lemma: [{ id: `H${String(word + 1).padStart(4, "0")}` }] }
              : { t: " " },
          ),
        },
      ],
    }));
    const { container } = render(
      <CIRRenderer
        verses={big}
        headings={[]}
        layout="per-line"
        wordsOfChrist="off"
        strongsEnabled
      />,
    );
    expect(container.querySelectorAll(".strongs-word")).toHaveLength(880);
    expect(container.querySelector(".strongs-popover")).not.toBeInTheDocument();
  });
});
