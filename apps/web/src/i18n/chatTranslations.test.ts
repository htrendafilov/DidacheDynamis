import { describe, expect, it } from "vitest";

import bg from "./bg.json";
import en from "./en.json";

describe("chat translations", () => {
  it("keeps every chat UI key available in English and Bulgarian", () => {
    const chatKeys = (messages: Record<string, string>) =>
      Object.keys(messages)
        .filter((key) => key.startsWith("chat."))
        .sort();

    expect(chatKeys(bg)).toEqual(chatKeys(en));
    for (const key of chatKeys(en)) {
      expect(bg[key as keyof typeof bg].trim(), key).not.toBe("");
      expect(en[key as keyof typeof en].trim(), key).not.toBe("");
    }
  });

  it("gives the Bulgarian disclaimer the same number of sentences as English, not a shortened version", () => {
    // plan/interactive_chat_plan.md §7.2: "The Bulgarian translation must convey the same
    // meaning, not shorten the warning." Sentence count is a cheap, real proxy for that.
    const sentenceCount = (text: string) => (text.match(/[.!?]+/g) ?? []).length;
    expect(sentenceCount(bg["chat.disclaimer"])).toBe(sentenceCount(en["chat.disclaimer"]));
  });

  it("gives the Bulgarian privacy note the same number of paragraphs as English", () => {
    const paragraphs = (text: string) => text.split("\n\n").length;
    expect(paragraphs(bg["chat.privacy.openrouterNote"])).toBe(
      paragraphs(en["chat.privacy.openrouterNote"]),
    );
  });

  it("has an error message for every ChatErrorKind", () => {
    const kinds = [
      "auth",
      "credit",
      "rateLimit",
      "modelUnavailable",
      "privacyConstraint",
      "emptyAnswer",
      "badRequest",
      "network",
      "malformedStream",
      "aborted",
    ];
    for (const kind of kinds) {
      const key = `chat.error.${kind}` as keyof typeof en;
      expect(en[key], key).toBeTruthy();
      expect(bg[key], key).toBeTruthy();
    }
  });
});
