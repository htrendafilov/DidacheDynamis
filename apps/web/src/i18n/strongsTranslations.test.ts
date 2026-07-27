import { describe, expect, it } from "vitest";

import bg from "./bg.json";
import en from "./en.json";

describe("Strong's translations", () => {
  it("keeps every Strong's UI key available in English and Bulgarian", () => {
    const strongsKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .filter(
          (key) =>
            key.startsWith("strongs.") ||
            key.startsWith("settings.strongs") ||
            key === "workInfo.type.lexicon",
        )
        .sort();

    expect(strongsKeys(bg)).toEqual(strongsKeys(en));
    for (const key of strongsKeys(en)) {
      expect(bg[key as keyof typeof bg].trim(), key).not.toBe("");
      expect(en[key as keyof typeof en].trim(), key).not.toBe("");
    }
  });
});
