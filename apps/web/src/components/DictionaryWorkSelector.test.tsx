import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Work } from "../data/api";
import i18n from "../i18n";
import { DictionaryWorkSelector } from "./DictionaryWorkSelector";

const work = (id: string, type: Work["type"], abbrev: string): Work => ({
  id,
  type,
  language: "en",
  title: abbrev,
  abbrev,
  direction: "ltr",
  versification: "none",
  license: "test",
  attribution: "test",
  source_url: null,
  source_version: null,
  ai_context_policy: "allowed",
});

describe("DictionaryWorkSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("selects between Easton's and the Strong's lexicons", () => {
    const onChange = vi.fn();
    render(
      <DictionaryWorkSelector
        works={[
          work("easton", "dictionary", "EBD"),
          work("strongsgreek", "lexicon", "StrGrk"),
          work("strongshebrew", "lexicon", "StrHeb"),
        ]}
        workId="strongsgreek"
        onChange={onChange}
      />,
    );
    const selector = screen.getByRole("combobox", { name: "Dictionary source" });
    expect(selector).toHaveValue("strongsgreek");
    fireEvent.change(selector, { target: { value: "easton" } });
    expect(onChange).toHaveBeenCalledWith("easton");
  });

  it("stays hidden when only one dictionary-family work is installed", () => {
    render(
      <DictionaryWorkSelector works={[work("easton", "dictionary", "EBD")]} workId="easton" onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("combobox", { name: "Dictionary source" })).not.toBeInTheDocument();
  });

  it("stays hidden while works is still loading", () => {
    render(<DictionaryWorkSelector works={null} workId="easton" onChange={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Dictionary source" })).not.toBeInTheDocument();
  });
});
