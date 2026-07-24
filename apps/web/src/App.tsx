import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ReadingSettings } from "./components/ReadingSettings";
import { SEARCH_DEFAULT_WIDTH, SearchDrawer } from "./components/SearchDrawer";
import { TopBar } from "./components/TopBar";
import { UpdateNotice } from "./components/UpdateNotice";
import { api } from "./data/api";
import { useWorks } from "./data/hooks";
import i18n from "./i18n";
import { bookName } from "./i18n/bookNames";
import { PaneHost } from "./panes/PaneHost";
import { MOBILE_MEDIA_QUERY } from "./responsive";
import {
  bibleDeepLinkExists,
  bookHash,
  parseBibleHash,
  parseBookHash,
} from "./state/deeplink";
import { useStore, type Pane } from "./state/store";
import { installDropboxAutoSync, useDropboxSync } from "./sync/dropboxState";

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
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
  const [searchEverOpened, setSearchEverOpened] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [deepLinkError, setDeepLinkError] = useState(false);
  const [activeMobile, setActiveMobile] = useState(0);
  const initializeDropbox = useDropboxSync((state) => state.initialize);
  const openBookSection = useStore((s) => s.openBookSection);
  const openPassage = useStore((s) => s.openPassage);
  const setSettings = useStore((s) => s.setSettings);
  const works = useWorks();
  const didInitDeepLink = useRef(false);
  const isNarrow = useIsNarrow();

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("state")?.startsWith("dbx-")) {
      setShowSettings(true);
    }
    void initializeDropbox();
    return installDropboxAutoSync();
  }, [initializeDropbox]);

  // Deep links applied once works are known (so a bogus work id is ignored) and re-applied on
  // hashchange (a shared/embedded link opened in the same tab): General Book sections
  // (#/book/<work>/<section>) and Bible passages (#/b/<work>/<osis>/<chapter>, used by embed.js).
  useEffect(() => {
    if (!works) return;
    let active = true;
    let requestId = 0;
    const bookIds = new Set(works.filter((w) => w.type === "book").map((w) => w.id));
    const bibleIds = new Set(works.filter((w) => w.type === "bible").map((w) => w.id));
    const rejectBibleLink = () => {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      setDeepLinkError(true);
    };
    const apply = async () => {
      const currentRequest = ++requestId;
      const hash = window.location.hash;
      const book = parseBookHash(hash);
      if (book && bookIds.has(book.workId)) {
        setDeepLinkError(false);
        openBookSection(book.workId, book.sectionId);
        return;
      }
      if (!hash.startsWith("#/b/")) return;
      const bible = parseBibleHash(hash);
      if (!bible || !bibleIds.has(bible.workId)) {
        rejectBibleLink();
        return;
      }
      try {
        const books = await api.books(bible.workId);
        if (!active || currentRequest !== requestId || window.location.hash !== hash) return;
        if (!bibleDeepLinkExists(bible, books)) {
          rejectBibleLink();
          return;
        }
        setDeepLinkError(false);
        openPassage(bible.workId, bible.osis, bible.chapter);
      } catch {
        // Keep the hash so a transient network failure can recover on reload.
      }
    };
    const onHashChange = () => void apply();
    if (!didInitDeepLink.current) {
      didInitDeepLink.current = true;
      void apply();
    }
    window.addEventListener("hashchange", onHashChange);
    return () => {
      active = false;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [works, openBookSection, openPassage]);

  // Mirror the first book pane's current section into the URL hash for sharing. replaceState keeps
  // history clean (scroll-spy changes the section often) and does not fire hashchange (no loop).
  useEffect(() => {
    const bookPane = panes.find((p) => p.type === "book");
    if (!bookPane?.sectionId) return;
    const target = bookHash(bookPane.workId, bookPane.sectionId);
    if (window.location.hash !== target) {
      window.history.replaceState(null, "", target);
    }
  }, [panes]);

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
    ({ bible: "📖", commentary: "💬", dictionary: "📔", book: "📚", notes: "📝" })[type];

  const MOBILE_PANEL_ID = "mobile-pane-panel";
  const tabId = (p: Pane) => `mobile-tab-${p.id}`;
  // Horizontal WAI-ARIA tabs: Left/Right/Home/End move selection and focus.
  // Leave Up/Down alone so they retain their normal page-scrolling behaviour.
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const n = panes.length;
    let next = activeIndex;
    if (e.key === "ArrowRight") next = (activeIndex + 1) % n;
    else if (e.key === "ArrowLeft") next = (activeIndex - 1 + n) % n;
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
          setShowSearch((v) => {
            if (!v) setSearchEverOpened(true);
            return !v;
          });
          setShowSettings(false);
        }}
        onToggleSettings={() => {
          setShowSettings((v) => !v);
          setShowSearch(false);
        }}
      />
      <UpdateNotice />
      {deepLinkError && (
        <aside className="link-error-notice" role="alert">
          <span>{t("link.invalidBible")}</span>
          <button type="button" onClick={() => setDeepLinkError(false)}>
            {t("common.dismiss")}
          </button>
        </aside>
      )}

      {showSettings && (
        <div className="overlay-panel">
          <ReadingSettings />
        </div>
      )}

      <div className="workspace">
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
        {searchEverOpened && (
          <SearchDrawer
            open={showSearch}
            fullscreen={isNarrow}
            width={settings.searchWidth ?? SEARCH_DEFAULT_WIDTH}
            onWidthChange={(searchWidth) => setSettings({ searchWidth })}
            onClose={() => setShowSearch(false)}
          />
        )}
      </div>
    </div>
  );
}
