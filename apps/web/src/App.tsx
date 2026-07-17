import { Fragment, useEffect, useState } from "react";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ReadingSettings } from "./components/ReadingSettings";
import { SearchPanel } from "./components/SearchPanel";
import { TopBar } from "./components/TopBar";
import i18n from "./i18n";
import { PaneHost } from "./panes/PaneHost";
import { useStore } from "./state/store";

export default function App() {
  const panes = useStore((s) => s.panes);
  const settings = useStore((s) => s.settings);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void i18n.changeLanguage(settings.uiLang);
  }, [settings.uiLang]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty("--font-scale", String(settings.fontScale));
  }, [settings.theme, settings.fontScale]);

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
      </main>
    </div>
  );
}
