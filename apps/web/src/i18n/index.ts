import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";

import { useStore, type UiLang } from "../state/store";
import bg from "./bg.json";

// Only the language a reader starts in belongs in the first-paint bundle; both files were
// ~60 kB of it. Bulgarian is bundled: it is the default and the majority language, and a
// serial request for its strings before the first render would slow most readers down to
// save a few kilobytes. English is loaded on demand — at startup when it is the persisted
// setting (main.tsx waits for it, so an English reader never sees a flash of Bulgarian),
// otherwise on the first switch.
const loaders: Record<UiLang, () => Promise<{ default: Record<string, string> }>> = {
  bg: () => Promise.resolve({ default: bg }),
  en: () => import("./en.json"),
};

const backend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const load = loaders[language as UiLang];
    if (!load) {
      callback(new Error(`no translations for "${language}"`), false);
      return;
    }
    // A failed chunk load is worth i18next's own retries; a language we do not have is not.
    load().then(
      (module) => callback(null, module.default),
      (err: unknown) => callback(err as Error, true),
    );
  },
};

// The store hydrates synchronously from localStorage, so the persisted language is known
// here, before anything renders.
export const i18nReady = i18n
  .use(backend)
  .use(initReactI18next)
  .init({
    resources: { bg: { translation: bg } },
    partialBundledLanguages: true,
    lng: useStore.getState().settings.uiLang,
    // The bundled language, so the fallback never costs a request. Both files carry the
    // same keys (parity.test.ts), so this only applies under a bug — and then Bulgarian
    // text beats a raw key on screen.
    fallbackLng: "bg",
    interpolation: { escapeValue: false },
  });

export default i18n;
