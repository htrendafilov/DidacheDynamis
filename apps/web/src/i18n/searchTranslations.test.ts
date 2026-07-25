import { describe, expect, it } from "vitest";

import bg from "./bg.json";
import en from "./en.json";

describe("search translations", () => {
  it("keeps every search UI key available in English and Bulgarian", () => {
    const searchKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .filter((key) => key.startsWith("search."))
        .sort();

    expect(searchKeys(bg)).toEqual(searchKeys(en));
    for (const key of searchKeys(en)) {
      expect(bg[key as keyof typeof bg].trim(), key).not.toBe("");
      expect(en[key as keyof typeof en].trim(), key).not.toBe("");
    }
  });
});
