import { useTranslation } from "react-i18next";

import { useStore } from "../state/store";

export function TopBar({
  onToggleSearch,
  onToggleSettings,
}: {
  onToggleSearch: () => void;
  onToggleSettings: () => void;
}) {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addPane = useStore((s) => s.addPane);
  const panes = useStore((s) => s.panes);

  return (
    <header className="topbar">
      <h1 className="brand">{t("app.title")}</h1>
      <div className="topbar-actions">
        <button type="button" onClick={onToggleSearch}>
          {t("topbar.search")}
        </button>
        <button type="button" onClick={addPane} disabled={panes.length >= 3}>
          + {t("topbar.addPane")}
        </button>
        <button type="button" onClick={onToggleSettings}>
          {t("topbar.settings")}
        </button>
        <button
          type="button"
          className="lang-toggle"
          aria-label={t("topbar.language")}
          onClick={() => setSettings({ uiLang: settings.uiLang === "en" ? "bg" : "en" })}
        >
          {settings.uiLang === "en" ? "БГ" : "EN"}
        </button>
      </div>
    </header>
  );
}
