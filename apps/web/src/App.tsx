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
  // Bible + commentary panes share a reference (e.g. "John 3"), so distinguish tabs by a
  // per-type icon (accessible — the full type is in aria-label, not conveyed by colour alone).
  const paneIcon = (type: Pane["type"]) =>
    ({ bible: "📖", commentary: "💬", dictionary: "📔", notes: "📝" })[type];

  const MOBILE_PANEL_ID = "mobile-pane-panel";
  const tabId = (p: Pane) => `mobile-tab-${p.id}`;
  // W3C tabs pattern: arrow/Home/End move selection and focus (roving tabIndex).
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const n = panes.length;
    let next = activeIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (activeIndex + 1) % n;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (activeIndex - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else return;
    e.preventDefault();
    setActiveMobile(next);
    requestAnimationFrame(() => document.getElementById(tabId(panes[next]))?.focus());
  };

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
                {panes.map((p, i) => {
                  const label = paneLabel(p);
                  const typeName = t(`source.${p.type}`);
                  const selected = i === activeIndex;
                  return (
                    <button
                      key={p.id}
                      id={tabId(p)}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={MOBILE_PANEL_ID}
                      tabIndex={selected ? 0 : -1}
                      aria-label={label === typeName ? typeName : `${typeName}: ${label}`}
                      className={selected ? `active pane-tab-${p.type}` : `pane-tab-${p.type}`}
                      onClick={() => setActiveMobile(i)}
                      onKeyDown={onTabKeyDown}
                    >
                      <span aria-hidden="true">{paneIcon(p.type)}</span> {label}
                    </button>
                  );
                })}
              </nav>
            )}
            <div
              className="mobile-pane"
              id={panes.length > 1 ? MOBILE_PANEL_ID : undefined}
              role={panes.length > 1 ? "tabpanel" : undefined}
              aria-labelledby={panes.length > 1 ? tabId(activePane) : undefined}
              tabIndex={panes.length > 1 ? 0 : undefined}
            >
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
