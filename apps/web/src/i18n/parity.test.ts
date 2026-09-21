import { describe, expect, it } from "vitest";

import bg from "./bg.json";
import en from "./en.json";

// The per-feature parity tests each cover their own prefix. This one covers the whole file,
// and it is what makes `fallbackLng` a safety net rather than a feature (index.ts): a key
// present in one language and missing in the other would otherwise reach a reader.
describe("translation files", () => {
  const placeholders = (text: string) => new Set(text.match(/{{\w+}}/g) ?? []);

  it("carry exactly the same keys in English and Bulgarian", () => {
    expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort());
  });

  it("use the same placeholders for every key, so no interpolation is silently dropped", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(placeholders(bg[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("have no empty strings", () => {
    for (const [key, value] of [...Object.entries(en), ...Object.entries(bg)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});
