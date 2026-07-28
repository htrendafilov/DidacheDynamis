import { describe, expect, it } from "vitest";

import { normalizeStrongId, strongLexiconWorkId } from "./strongs";

describe("Strong's identifier helpers", () => {
  it("normalizes supported padding, case, and suffixes", () => {
    expect(normalizeStrongId("h1254")).toBe("H1254");
    expect(normalizeStrongId("H01254")).toBe("H1254");
    expect(normalizeStrongId("g26")).toBe("G0026");
    expect(normalizeStrongId("g0031a")).toBe("G0031A");
  });

  it("matches the API's bounded ASCII input contract", () => {
    expect(normalizeStrongId("H123456")).toBeNull();
    expect(normalizeStrongId(`H${"9".repeat(5000)}`)).toBeNull();
    expect(normalizeStrongId("H١٢٥٤")).toBeNull();
  });

  it("maps normalized ids to their attribution work", () => {
    expect(strongLexiconWorkId("G0001")).toBe("strongsgreek");
    expect(strongLexiconWorkId("H0001")).toBe("strongshebrew");
  });
});
