import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ReadingSettings } from "./components/ReadingSettings";
import { SearchPanel } from "./components/SearchPanel";
import { TopBar } from "./components/TopBar";
import i18n from "./i18n";
import { bookName } from "./i18n/bookNames";
import { PaneHost } from "./panes/PaneHost";
import { useStore, type Pane } from "./state/store";
import { installDropboxAutoSync, useDropboxSync } from "./sync/dropboxState";

function useIsNarrow(): boolean {
  const query = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export default function App() {
  const { t, i18n: i18nInstance } = useTranslation();
  const panes = useStore((s) => s.panes);
  const settings = useStore((s) => s.settings);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeMobile, setActiveMobile] = useState(0);
  const initializeDropbox = useDropboxSync((state) => state.initialize);
  const isNarrow = useIsNarrow();

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("state")?.startsWith("dbx-")) {
      setShowSettings(true);
    }
    void initializeDropbox();
    return installDropboxAutoSync();
  }, [initializeDropbox]);

  useEffect(() => {
    void i18n.changeLanguage(settings.uiLang);
  }, [settings.uiLang]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.uiLang;
    document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
  }, [settings.theme, settings.uiLang, settings.fontScale]);

  const activeIndex = Math.min(activeMobile, panes.length - 1);
  const activePane = panes[activeIndex];

  const paneLabel = (p: Pane) =>
    p.type === "bible" || p.type === "commentary"
      ? `${bookName(p.osis, i18nInstance.language, p.osis)} ${p.chapter}`
      : t(`source.${p.type}`);

  return (
    <div className="app">
      <TopBar
        onToggleSearch={() => {
          setShowSearch((v) => !v);
          setShowSettings(false);
        }}
        onToggleSettings={() => {
          setShowSettings((v) => !v);
          setShowSearch(false);
        }}
      />

      {showSettings && (
        <div className="overlay-panel">
          <ReadingSettings />
        </div>
      )}
      {showSearch && (
        <div className="overlay-panel">
          <SearchPanel onClose={() => setShowSearch(false)} />
        </div>
      )}

      <main className="panes">
        {isNarrow ? (
          <div className="mobile-panes">
            {panes.length > 1 && (
              <nav className="mobile-pane-tabs" role="tablist" aria-label={t("panes.switch")}>
                {panes.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={i === activeIndex}
                    className={i === activeIndex ? "active" : ""}
                    onClick={() => setActiveMobile(i)}
                  >
                    {paneLabel(p)}
                  </button>
                ))}
              </nav>
            )}
            <div className="mobile-pane">
              <PaneHost pane={activePane} />
            </div>
          </div>
        ) : (
          <PanelGroup direction="horizontal" autoSaveId="bible-panes">
            {panes.map((p, i) => (
              <Fragment key={p.id}>
                {i > 0 && <PanelResizeHandle className="resize-handle" />}
                <Panel minSize={20} id={p.id} order={i}>
                  <PaneHost pane={p} />
                </Panel>
              </Fragment>
            ))}
          </PanelGroup>
        )}
      </main>
    </div>
  );
}
