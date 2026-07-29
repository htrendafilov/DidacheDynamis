import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Book, Work } from "../data/api";
import i18n from "../i18n";
import { WorkFooter } from "./WorkFooter";

const web: Work = {
  id: "web",
  type: "bible",
  language: "en",
  title: "World English Bible",
  abbrev: "WEB",
  direction: "ltr",
  versification: "kjv",
  license: "Public Domain",
  attribution:
    'The World English Bible is in the Public Domain. "World English Bible" is a Trademark of eBible.org.',
  source_url: "https://ebible.org/",
  source_version: "2024 USFX",
  ai_context_policy: "allowed",
};

const books: Book[] = [
  { osis: "Gen", name: "Genesis", order: 1, chapter_count: 50 },
  { osis: "John", name: "John", order: 43, chapter_count: 21 },
];

describe("WorkFooter", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("keeps attribution visible and opens all source-information tabs", () => {
    render(<WorkFooter work={web} books={books} />);

    expect(screen.getByText(/Trademark of eBible.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Info/ }));
    expect(screen.getByRole("dialog", { name: "World English Bible" })).toBeInTheDocument();
    expect(screen.getByText("2024 USFX")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Book list" }));
    expect(screen.getByText("Genesis")).toBeInTheDocument();
    expect(screen.getByText("50 chapters")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copyright" }));
    expect(screen.getByText("Public Domain")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publisher / source" }));
    expect(screen.getByRole("link", { name: "Open the source website" })).toHaveAttribute(
      "href",
      "https://ebible.org/",
    );
  });

  it("omits the book list for sources that do not have books", () => {
    render(<WorkFooter work={{ ...web, id: "easton", type: "dictionary" }} />);
    fireEvent.click(screen.getByRole("button", { name: /Info/ }));
    expect(screen.queryByRole("button", { name: "Book list" })).not.toBeInTheDocument();
  });
});
