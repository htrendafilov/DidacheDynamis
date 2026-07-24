import { useTranslation } from "react-i18next";

import {
  useStore,
  type BookReadingMode,
  type Theme,
  type UiLang,
  type VerseLayout,
  type WordsOfChrist,
} from "../state/store";
import { DropboxSyncSettings } from "./DropboxSyncSettings";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={value === o.value ? "seg active" : "seg"}
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReadingSettings() {
  const { t, i18n } = useTranslation();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  return (
    <div className="reading-settings" role="dialog" aria-label={t("topbar.settings")}>
      <div className="setting">
        <span className="setting-label">{t("topbar.language")}</span>
        <select
          aria-label={t("topbar.language")}
          value={settings.uiLang}
          onChange={(e) => {
            const uiLang = e.target.value as UiLang;
            setSettings({ uiLang });
            void i18n.changeLanguage(uiLang);
          }}
        >
          <option value="en">English</option>
          <option value="bg">Български</option>
        </select>
      </div>
      <Segmented<VerseLayout>
        label={t("settings.verseLayout")}
        value={settings.verseLayout}
        onChange={(v) => setSettings({ verseLayout: v })}
        options={[
          { value: "per-line", label: t("settings.perLine") },
          { value: "flowing", label: t("settings.flowing") },
        ]}
      />
      <Segmented<WordsOfChrist>
        label={t("settings.wordsOfChrist")}
        value={settings.wordsOfChrist}
        onChange={(v) => setSettings({ wordsOfChrist: v })}
        options={[
          { value: "off", label: t("settings.off") },
          { value: "bold", label: t("settings.bold") },
          { value: "red", label: t("settings.red") },
        ]}
      />
      <Segmented<Theme>
        label={t("settings.theme")}
        value={settings.theme}
        onChange={(v) => setSettings({ theme: v })}
        options={[
          { value: "light", label: t("settings.light") },
          { value: "dark", label: t("settings.dark") },
        ]}
      />
      <div className="setting">
        <span className="setting-label">{t("settings.fontSize")}</span>
        <input
          type="range"
          aria-label={t("settings.fontSize")}
          min={0.8}
          max={1.6}
          step={0.1}
          value={settings.fontScale}
          onChange={(e) => setSettings({ fontScale: Number(e.target.value) })}
        />
      </div>
      <label className="setting checkbox">
        <input
          type="checkbox"
          checked={settings.sync}
          onChange={(e) => setSettings({ sync: e.target.checked })}
        />
        {t("settings.sync")}
      </label>
      <Segmented<BookReadingMode>
        label={t("settings.bookView")}
        value={settings.bookMode ?? "paged"}
        onChange={(bookMode) => setSettings({ bookMode })}
        options={[
          { value: "paged", label: t("settings.bookPaged") },
          { value: "scroll", label: t("settings.bookScroll") },
        ]}
      />
      <DropboxSyncSettings />
    </div>
  );
}
