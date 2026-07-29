import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Work } from "../data/api";
import i18n from "../i18n";
import { BibleVersionSelector } from "./BibleVersionSelector";

const work = (id: string, abbrev: string): Work => ({
  id,
  type: "bible",
  language: "en",
  title: abbrev,
  abbrev,
  direction: "ltr",
  versification: "kjv",
  license: "test",
  attribution: "test",
  source_url: null,
  source_version: null,
  ai_context_policy: "allowed",
});

describe("BibleVersionSelector", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("selects between WEB and KJV works", () => {
    const onChange = vi.fn();
    render(
      <BibleVersionSelector
        works={[work("web", "WEB"), work("kjv", "KJV")]}
        workId="web"
        onChange={onChange}
      />,
    );
    const selector = screen.getByRole("combobox", { name: "Bible version" });
    expect(selector).toHaveValue("web");
    fireEvent.change(selector, { target: { value: "kjv" } });
    expect(onChange).toHaveBeenCalledWith("kjv");
  });
});
