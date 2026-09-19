import { beforeEach, describe, expect, it, vi } from "vitest";

// Module-level behaviour, so every test re-imports a fresh i18n and a fresh store — the
// store is what reads the persisted language, synchronously, before anything renders.
describe("i18n bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  const persist = (uiLang: string) =>
    localStorage.setItem("bible-app", JSON.stringify({ state: { settings: { uiLang } }, version: 0 }));

  it("starts in Bulgarian with nothing persisted, without loading the English strings", async () => {
    const { default: i18n, i18nReady } = await import("./index");
    await i18nReady;
    expect(i18n.language).toBe("bg");
    expect(i18n.t("chat.send")).toBe("Изпрати");
    expect(i18n.hasResourceBundle("en", "translation")).toBe(false);
  });

  it("loads English on the first switch and serves it from then on", async () => {
    const { default: i18n, i18nReady } = await import("./index");
    await i18nReady;
    await i18n.changeLanguage("en");
    expect(i18n.t("chat.send")).toBe("Send");
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);
    await i18n.changeLanguage("bg");
    await i18n.changeLanguage("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });

  it("starts in the persisted language, with its strings loaded before the app renders", async () => {
    persist("en");
    const { default: i18n, i18nReady } = await import("./index");
    await i18nReady;
    expect(i18n.language).toBe("en");
    expect(i18n.t("chat.send")).toBe("Send");
  });

  it("falls back to the bundled Bulgarian for a persisted language it has no strings for", async () => {
    persist("xx");
    const { default: i18n, i18nReady } = await import("./index");
    await i18nReady;
    expect(i18n.t("chat.send")).toBe("Изпрати");
  });
});
