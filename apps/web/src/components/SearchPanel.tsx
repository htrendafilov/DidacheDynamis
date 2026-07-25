import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type SearchGroup,
  type SearchHit,
  type SearchKind,
  type SearchSort,
} from "../data/api";
import { useBooks, useWorks } from "../data/hooks";
import { bookName } from "../i18n/bookNames";
import {
  loadSearchHistory,
  rememberSearch,
  removeSearch,
  saveSearchHistory,
  toggleSearchPinned,
  type SearchHistoryEntry,
  type SearchState,
} from "../search/history";
import { useStore } from "../state/store";

const KIND_ORDER: SearchKind[] = ["bible", "commentary", "dictionary", "book"];
const KIND_ICON: Record<SearchKind, string> = {
  bible: "📖",
  commentary: "💬",
  dictionary: "📔",
  book: "📚",
};
const PAGE = 50;

interface GroupState {
  total: number;
  hits: SearchHit[];
  hasMore: boolean;
}

type Selected = "all" | SearchKind;

// The API's FTS snippet marks matches with <b>…</b> only. Render it without dangerouslySetInnerHTML:
// split on those markers and let React escape the text, so stray markup can never become HTML.
function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<b>|<\/b>)/);
  let bold = false;
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part === "<b>") bold = true;
    else if (part === "</b>") bold = false;
    else if (part) nodes.push(bold ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>);
  });
  return <>{nodes}</>;
}

export function SearchPanel({
  mode = "fullscreen",
  open = true,
  onNavigate,
  onClose,
  restoreResultFocus = false,
}: {
  mode?: "docked" | "fullscreen";
  open?: boolean;
  onNavigate?: (kind: SearchKind) => void;
  onClose: () => void;
  restoreResultFocus?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const works = useWorks();
  const bookWorkId = works?.find((work) => work.type === "bible")?.id ?? "web";
  const books = useBooks(bookWorkId);
  const openPassage = useStore((s) => s.openPassage);
  const openCommentary = useStore((s) => s.openCommentary);
  const openDictionary = useStore((s) => s.openDictionary);
  const openBookSection = useStore((s) => s.openBookSection);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const filterDialogRef = useRef<HTMLElement>(null);
  const filterCloseRef = useRef<HTMLButtonElement>(null);
  const lastResultButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef(new Map<Selected, HTMLButtonElement>());
  const requestId = useRef(0);

  // Focus the query field when the workspace opens (the input stays mounted across collapse, so a
  // one-time autoFocus is not enough). Returning from a mobile result instead restores focus to
  // that result without scrolling the retained results workspace back to the top.
  useEffect(() => {
    if (!open) return;
    if (restoreResultFocus && lastResultButtonRef.current) {
      lastResultButtonRef.current.focus({ preventScroll: true });
    } else {
      inputRef.current?.focus();
    }
  }, [open, restoreResultFocus]);

  const [q, setQ] = useState("");
  const [refine, setRefine] = useState("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [canon, setCanon] = useState<"" | "ot" | "nt">("");
  const [workFilter, setWorkFilter] = useState<Set<string>>(new Set());
  const [bookFilter, setBookFilter] = useState<Set<string>>(new Set());
  const [bookQuery, setBookQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(loadSearchHistory);
  const [selected, setSelected] = useState<Selected>("all");
  const [groups, setGroups] = useState<Partial<Record<SearchKind, GroupState>>>({});
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!open) setFiltersOpen(false);
  }, [open]);

  useEffect(() => {
    if (!filtersOpen) return;
    filterCloseRef.current?.focus();
    const dialog = filterDialogRef.current;
    const close = () => {
      setFiltersOpen(false);
      requestAnimationFrame(() => filterButtonRef.current?.focus());
    };
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )].filter(
        (element) =>
          element.tagName === "SUMMARY" || !element.closest("details:not([open])"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeys);
    return () => window.removeEventListener("keydown", handleKeys);
  }, [filtersOpen]);

  const merge = (group: SearchGroup): GroupState => ({
    total: group.total,
    hits: group.hits,
    hasMore: group.has_more,
  });

  // Build query params from current state, with explicit overrides for the control that just changed
  // (React state updates are async, so we cannot read the new value back from state in the handler).
  function buildOpts(
    over: {
      sort?: SearchSort;
      refine?: string;
      canon?: "" | "ot" | "nt";
      works?: Set<string>;
      books?: Set<string>;
      types?: string;
      offset?: number;
    } = {},
  ) {
    const effWorks = over.works ?? workFilter;
    const effBooks = over.books ?? bookFilter;
    return {
      sort: over.sort ?? sort,
      refine: (over.refine ?? refine).trim() || undefined,
      canon: (over.canon ?? canon) || undefined,
      works: effWorks.size ? [...effWorks].join(",") : undefined,
      books: effBooks.size ? [...effBooks].join(",") : undefined,
      types: over.types,
      offset: over.offset,
    };
  }

  async function execute(
    query: string,
    selection: Selected,
    o: ReturnType<typeof buildOpts>,
  ) {
    if (!query) return false;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    setAnnouncement(t("search.loading"));
    try {
      if (selection === "all") {
        const res = await api.search(query, o);
        if (currentRequest !== requestId.current) return false;
        const map: Partial<Record<SearchKind, GroupState>> = {};
        res.groups.forEach((g) => (map[g.type] = merge(g)));
        setGroups(map);
        setAnnouncement(t("search.resultsLoaded", { total: res.total }));
      } else {
        const res = await api.search(query, { ...o, types: selection, offset: o.offset ?? 0 });
        if (currentRequest !== requestId.current) return false;
        const g = res.groups[0];
        if (g) {
          setGroups((prev) => ({ ...prev, [selection]: merge(g) }));
          setAnnouncement(t("search.resultsLoaded", { total: g.total }));
        }
      }
      return true;
    } catch {
      if (currentRequest !== requestId.current) return false;
      setError(true);
      setAnnouncement(t("search.error"));
      return false;
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    setSelected("all");
    setSearched(true);
    setGroups({});
    const opts = buildOpts();
    if (await execute(query, "all", opts)) {
      setHistoryOpen(false);
      remember(snapshot({ query, selected: "all" }));
    }
  }

  function selectTab(next: Selected) {
    setSelected(next);
    if (searched) {
      void execute(q.trim(), next, buildOpts()).then((ok) => {
        if (ok) remember(snapshot({ selected: next }));
      });
    }
  }

  function snapshot(
    over: {
      query?: string;
      refine?: string;
      sort?: SearchSort;
      canon?: "" | "ot" | "nt";
      works?: Set<string>;
      books?: Set<string>;
      selected?: Selected;
    } = {},
  ): SearchState {
    return {
      query: over.query ?? q,
      refine: over.refine ?? refine,
      sort: over.sort ?? sort,
      canon: over.canon ?? canon,
      works: [...(over.works ?? workFilter)],
      books: [...(over.books ?? bookFilter)],
      selected: over.selected ?? selected,
    };
  }

  function remember(state: SearchState) {
    setHistory((previous) => {
      const next = rememberSearch(previous, state);
      saveSearchHistory(next);
      return next;
    });
  }

  function updateHistory(change: (entries: SearchHistoryEntry[]) => SearchHistoryEntry[]) {
    setHistory((previous) => {
      const next = change(previous);
      saveSearchHistory(next);
      return next;
    });
  }

  function applyFilter(
    o: ReturnType<typeof buildOpts>,
    state: SearchState,
  ) {
    if (searched) {
      setGroups({});
      void execute(state.query.trim(), state.selected, o).then((ok) => {
        if (ok) remember(state);
      });
    }
  }

  function applyCanon(value: "" | "ot" | "nt") {
    setCanon(value);
    applyFilter(buildOpts({ canon: value }), snapshot({ canon: value }));
  }

  function applyWorks(next: Set<string>) {
    setWorkFilter(next);
    applyFilter(buildOpts({ works: next }), snapshot({ works: next }));
  }

  function applyBooks(next: Set<string>) {
    setBookFilter(next);
    applyFilter(buildOpts({ books: next }), snapshot({ books: next }));
  }

  function applyRefinement(value: string) {
    setRefine(value);
    applyFilter(buildOpts({ refine: value }), snapshot({ refine: value }));
  }

  function runRefinement(event: React.FormEvent) {
    event.preventDefault();
    applyRefinement(refine.trim());
  }

  function clearFilters() {
    const emptyWorks = new Set<string>();
    const emptyBooks = new Set<string>();
    setCanon("");
    setRefine("");
    setWorkFilter(emptyWorks);
    setBookFilter(emptyBooks);
    applyFilter(
      buildOpts({ refine: "", canon: "", works: emptyWorks, books: emptyBooks }),
      snapshot({ refine: "", canon: "", works: emptyWorks, books: emptyBooks }),
    );
  }

  function clearSearch() {
    requestId.current += 1;
    setQ("");
    setRefine("");
    setSort("relevance");
    setCanon("");
    setWorkFilter(new Set());
    setBookFilter(new Set());
    setBookQuery("");
    setSelected("all");
    setGroups({});
    setSearched(false);
    setLoading(false);
    setLoadingMore(false);
    setError(false);
    setAnnouncement("");
    setFiltersOpen(false);
    inputRef.current?.focus();
  }

  async function restoreHistory(entry: SearchHistoryEntry) {
    const works = new Set(entry.works);
    const restoredBooks = new Set(entry.books);
    setQ(entry.query);
    setRefine(entry.refine);
    setSort(entry.sort);
    setCanon(entry.canon);
    setWorkFilter(works);
    setBookFilter(restoredBooks);
    setSelected(entry.selected);
    setGroups({});
    const ok = await execute(
      entry.query,
      entry.selected,
      buildOpts({
        refine: entry.refine,
        sort: entry.sort,
        canon: entry.canon,
        works,
        books: restoredBooks,
      }),
    );
    if (ok) {
      setSearched(true);
      setHistoryOpen(false);
      remember(entry);
    }
  }

  async function loadMore(kind: SearchKind) {
    const current = groups[kind];
    if (!current) return;
    const currentRequest = ++requestId.current;
    setLoadingMore(true);
    setError(false);
    setAnnouncement(t("search.loadingMore"));
    try {
      const res = await api.search(
        q.trim(),
        buildOpts({ types: kind, offset: current.hits.length }),
      );
      if (currentRequest !== requestId.current) return;
      const g = res.groups[0];
      if (g) {
        setGroups((prev) => ({
          ...prev,
          [kind]: { total: g.total, hits: [...current.hits, ...g.hits], hasMore: g.has_more },
        }));
        setAnnouncement(
          t("search.resultsAppended", {
            count: g.hits.length,
            shown: current.hits.length + g.hits.length,
            total: g.total,
          }),
        );
      }
    } catch {
      if (currentRequest !== requestId.current) return;
      setError(true);
      setAnnouncement(t("search.error"));
    } finally {
      if (currentRequest === requestId.current) setLoadingMore(false);
    }
  }

  const grandTotal = KIND_ORDER.reduce((sum, k) => sum + (groups[k]?.total ?? 0), 0);
  const nothingFound = searched && !error && grandTotal === 0;

  function label(hit: SearchHit): string {
    if (hit.kind === "bible")
      return `${bookName(hit.osis, i18n.language, hit.osis)} ${hit.chapter}:${hit.verse}`;
    if (hit.kind === "commentary")
      return `${bookName(hit.osis, i18n.language, hit.osis)} ${hit.chapter}${
        hit.verse_start ? `:${hit.verse_start}` : ""
      }`;
    return hit.title;
  }

  function openHit(hit: SearchHit, button: HTMLButtonElement) {
    lastResultButtonRef.current = button;
    if (hit.kind === "bible") openPassage(hit.work_id, hit.osis, hit.chapter, hit.verse);
    else if (hit.kind === "commentary") openCommentary(hit.work_id, hit.osis, hit.chapter);
    else if (hit.kind === "dictionary") openDictionary(hit.work_id, hit.headword);
    else openBookSection(hit.work_id, hit.section_id);
    // Zustand actions are synchronous, so the destination pane exists before the shell selects it.
    onNavigate?.(hit.kind);
    // Docked (desktop) stays open so several results can be read; full-screen (mobile) closes to
    // reveal the pane the result opened in.
    if (mode === "fullscreen") onClose();
  }

  // A called function (not a nested <Component/>) so the results stay part of this component's tree
  // and do not remount — remounting would detach the buttons between render and click.
  function resultList(hits: SearchHit[], kind: SearchKind) {
    return (
      <ul className="search-results">
        {hits.map((hit) => (
          <li key={`${kind}-${hit.work_id}-${label(hit)}-${hit.snippet.slice(0, 12)}`}>
            <button
              type="button"
              className={kind === "bible" ? "result" : "result result-book"}
              onClick={(event) => openHit(hit, event.currentTarget)}
            >
              <span aria-hidden="true">{KIND_ICON[kind]}</span>{" "}
              <span className="result-ref">{label(hit)}</span>{" "}
              <span className="result-version">
                {works?.find((w) => w.id === hit.work_id)?.abbrev ?? hit.work_id.toUpperCase()}
              </span>{" "}
              <span className="result-snippet">
                <Snippet html={hit.snippet} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const visibleKinds = KIND_ORDER.filter(
    (kind) => (groups[kind]?.total ?? 0) > 0 || (selected === kind && groups[kind] !== undefined),
  );
  const selectedWorks = works?.filter((work) => workFilter.has(work.id)) ?? [];
  const selectedBooks =
    books
      ?.filter((book) => bookFilter.has(book.osis))
      .map((book) => ({
        osis: book.osis,
        label: bookName(book.osis, i18n.language, book.name),
      })) ?? [];
  const normalizedBookQuery = bookQuery.trim().toLocaleLowerCase(i18n.language);
  const visibleBooks =
    books?.filter((book) =>
      bookName(book.osis, i18n.language, book.name)
        .toLocaleLowerCase(i18n.language)
        .includes(normalizedBookQuery),
    ) ?? [];
  const activeFilterCount =
    (refine.trim() ? 1 : 0) + (canon ? 1 : 0) + workFilter.size + bookFilter.size;
  const pinnedHistory = history.filter((entry) => entry.pinned);
  const recentHistory = history.filter((entry) => !entry.pinned);
  const historyVisible = historyOpen || (!q.trim() && history.length > 0);

  function closeFilters() {
    setFiltersOpen(false);
    requestAnimationFrame(() => filterButtonRef.current?.focus());
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: Selected) {
    const tabs: Selected[] = ["all", ...visibleKinds];
    const index = tabs.indexOf(current);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const next = tabs[nextIndex];
    selectTab(next);
    requestAnimationFrame(() => tabRefs.current.get(next)?.focus());
  }

  function historyDetails(entry: SearchHistoryEntry) {
    const details: string[] = [
      t(
        entry.sort === "relevance"
          ? "search.sortRelevance"
          : "search.sortCanonical",
      ),
    ];
    if (entry.selected !== "all") details.push(t(`source.${entry.selected}`));
    if (entry.canon) {
      details.push(t(entry.canon === "ot" ? "search.testOt" : "search.testNt"));
    }
    details.push(
      ...entry.works.map(
        (workId) => works?.find((work) => work.id === workId)?.abbrev ?? workId,
      ),
    );
    details.push(
      ...entry.books.map((osis) => {
        const fallback = books?.find((book) => book.osis === osis)?.name ?? osis;
        return bookName(osis, i18n.language, fallback);
      }),
    );
    return details.join(" · ");
  }

  function historyList(entries: SearchHistoryEntry[], title: string) {
    if (entries.length === 0) return null;
    return (
      <section>
        <h4>{title}</h4>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="search-history-rerun"
                onClick={() => void restoreHistory(entry)}
                aria-label={t("search.rerunSearch", { query: entry.query })}
              >
                <strong>{entry.query}</strong>
                {entry.refine && (
                  <span>{t("search.refineWith", { query: entry.refine })}</span>
                )}
                <small>{historyDetails(entry)}</small>
              </button>
              <button
                type="button"
                aria-label={t(
                  entry.pinned ? "search.unpinSearch" : "search.pinSearch",
                  { query: entry.query },
                )}
                title={t(entry.pinned ? "search.unpin" : "search.pin")}
                onClick={() =>
                  updateHistory((previous) =>
                    toggleSearchPinned(previous, entry.id),
                  )
                }
              >
                <span aria-hidden>{entry.pinned ? "★" : "☆"}</span>
              </button>
              <button
                type="button"
                aria-label={t("search.deleteSearch", { query: entry.query })}
                title={t("search.delete")}
                onClick={() =>
                  updateHistory((previous) => removeSearch(previous, entry.id))
                }
              >
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  function filterControls() {
    return (
      <div className="search-filter-controls">
        <div className="search-filter-section">
          <span className="search-filter-label">{t("search.testamentLabel")}</span>
          <div className="search-sort" role="group" aria-label={t("search.testamentLabel")}>
            {(["", "ot", "nt"] as const).map((value) => (
              <button
                key={value || "all"}
                type="button"
                className={canon === value ? "active" : ""}
                aria-pressed={canon === value}
                onClick={() => applyCanon(value)}
              >
                {t(
                  value === ""
                    ? "search.testAll"
                    : value === "ot"
                      ? "search.testOt"
                      : "search.testNt",
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="search-filter-section">
          <span className="search-filter-label">{t("search.sortLabel")}</span>
          <div className="search-sort" role="group" aria-label={t("search.sortLabel")}>
            {(["relevance", "canonical"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={sort === value ? "active" : ""}
                aria-pressed={sort === value}
                onClick={() => {
                  setSort(value);
                  applyFilter(
                    buildOpts({ sort: value }),
                    snapshot({ sort: value }),
                  );
                }}
              >
                {t(
                  value === "relevance"
                    ? "search.sortRelevance"
                    : "search.sortCanonical",
                )}
              </button>
            ))}
          </div>
        </div>

        {works && works.length > 0 && (
          <details className="search-works">
            <summary>
              {t("search.sources")}
              {workFilter.size > 0 ? ` (${workFilter.size})` : ""}
            </summary>
            <div className="search-works-list">
              {works
                .filter((work) => work.type !== "xref")
                .map((work) => (
                  <label key={work.id}>
                    <input
                      type="checkbox"
                      checked={workFilter.has(work.id)}
                      onChange={(event) => {
                        const next = new Set(workFilter);
                        if (event.target.checked) next.add(work.id);
                        else next.delete(work.id);
                        applyWorks(next);
                      }}
                    />
                    {work.abbrev} <span className="muted">{work.title}</span>
                  </label>
                ))}
            </div>
          </details>
        )}

        {books && books.length > 0 && (
          <details className="search-books">
            <summary>
              {t("search.books")}
              {bookFilter.size > 0 ? ` (${bookFilter.size})` : ""}
            </summary>
            <div className="search-book-picker">
              <input
                type="search"
                value={bookQuery}
                aria-label={t("search.findBook")}
                placeholder={t("search.findBook")}
                onChange={(event) => setBookQuery(event.target.value)}
              />
              <div className="search-book-list" role="group" aria-label={t("search.books")}>
                {visibleBooks.map((book) => {
                  const label = bookName(book.osis, i18n.language, book.name);
                  return (
                    <label key={book.osis}>
                      <input
                        type="checkbox"
                        checked={bookFilter.has(book.osis)}
                        onChange={(event) => {
                          const next = new Set(bookFilter);
                          if (event.target.checked) next.add(book.osis);
                          else next.delete(book.osis);
                          applyBooks(next);
                        }}
                      />
                      {label}
                    </label>
                  );
                })}
                {visibleBooks.length === 0 && (
                  <span className="muted">{t("search.noBooks")}</span>
                )}
              </div>
            </div>
          </details>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div
        className={`search-panel search-panel-${mode}`}
        aria-busy={loading || loadingMore}
      >
        <div className="search-workspace-header">
        <h2>{t("search.workspace")}</h2>
        <button type="button" onClick={onClose} aria-label={t("search.close")}>
          ✕
        </button>
      </div>
      <form onSubmit={run} className="search-form">
        <input
          ref={inputRef}
          type="search"
          value={q}
          aria-label={t("search.query")}
          placeholder={t("search.placeholder")}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">{t("topbar.search")}</button>
        {searched && (
          <button
            type="button"
            aria-label={t("search.clearSearch")}
            title={t("search.clearSearch")}
            onClick={clearSearch}
          >
            <span aria-hidden>⌫</span>
          </button>
        )}
        <button
          type="button"
          aria-expanded={historyVisible}
          aria-label={t("search.history")}
          title={t("search.history")}
          onClick={() => setHistoryOpen((value) => !value)}
        >
          <span aria-hidden>◷</span>
        </button>
      </form>

      {historyVisible && (
        <section className="search-history" aria-label={t("search.history")}>
          <header>
            <h3>{t("search.history")}</h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setHistory([]);
                  saveSearchHistory([]);
                  setHistoryOpen(false);
                }}
              >
                {t("search.clearHistory")}
              </button>
            )}
          </header>
          {history.length === 0 ? (
            <p className="muted">{t("search.noHistory")}</p>
          ) : (
            <>
              {historyList(pinnedHistory, t("search.pinned"))}
              {historyList(recentHistory, t("search.recent"))}
            </>
          )}
        </section>
      )}

      {searched && (
        <form className="search-refine-form" onSubmit={runRefinement}>
          <input
            type="search"
            value={refine}
            aria-label={t("search.refine")}
            placeholder={t("search.refinePlaceholder")}
            onChange={(event) => setRefine(event.target.value)}
          />
          <button type="submit">{t("search.applyRefine")}</button>
        </form>
      )}

      {searched && mode === "docked" && (
        <div className="search-filters">{filterControls()}</div>
      )}

      {searched && mode === "fullscreen" && (
        <div className="search-filter-toolbar">
          <button
            ref={filterButtonRef}
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="search-filter-sheet"
            onClick={() => setFiltersOpen(true)}
          >
            ☷ {t("search.filters")}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      )}

      {searched && activeFilterCount > 0 && (
        <div className="search-filter-chips" aria-label={t("search.activeFilters")}>
          {refine.trim() && (
            <button
              type="button"
              onClick={() => applyRefinement("")}
              aria-label={t("search.removeFilter", {
                filter: t("search.refineWith", { query: refine.trim() }),
              })}
            >
              {t("search.refineWith", { query: refine.trim() })}{" "}
              <span aria-hidden>×</span>
            </button>
          )}
          {canon && (
            <button
              type="button"
              onClick={() => applyCanon("")}
              aria-label={t("search.removeFilter", {
                filter: t(canon === "ot" ? "search.testOt" : "search.testNt"),
              })}
            >
              {t(canon === "ot" ? "search.testOt" : "search.testNt")} <span aria-hidden>×</span>
            </button>
          )}
          {selectedWorks.map((work) => (
            <button
              type="button"
              key={work.id}
              onClick={() => {
                const next = new Set(workFilter);
                next.delete(work.id);
                applyWorks(next);
              }}
              aria-label={t("search.removeFilter", { filter: work.abbrev })}
            >
              {work.abbrev} <span aria-hidden>×</span>
            </button>
          ))}
          {selectedBooks.map((book) => (
            <button
              type="button"
              key={book.osis}
              onClick={() => {
                const next = new Set(bookFilter);
                next.delete(book.osis);
                applyBooks(next);
              }}
              aria-label={t("search.removeFilter", { filter: book.label })}
            >
              {book.label} <span aria-hidden>×</span>
            </button>
          ))}
          <button type="button" className="search-clear-filters" onClick={clearFilters}>
            {t("search.clearFilters")}
          </button>
        </div>
      )}

      {searched && mode === "fullscreen" && filtersOpen && (
        <>
          <button
            type="button"
            className="search-filter-sheet-scrim"
            tabIndex={-1}
            aria-hidden="true"
            onClick={closeFilters}
          />
          <section
            id="search-filter-sheet"
            ref={filterDialogRef}
            className="search-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("search.filters")}
          >
            <header>
              <h3>{t("search.filters")}</h3>
              <button
                ref={filterCloseRef}
                type="button"
                aria-label={t("search.closeFilters")}
                onClick={closeFilters}
              >
                ✕
              </button>
            </header>
            {filterControls()}
          </section>
        </>
      )}

      {searched && visibleKinds.length > 0 && (
        <nav className="search-tabs" role="tablist" aria-label={t("search.groups")}>
          <button
            id="search-tab-all"
            ref={(element) => {
              if (element) tabRefs.current.set("all", element);
              else tabRefs.current.delete("all");
            }}
            type="button"
            role="tab"
            aria-selected={selected === "all"}
            aria-controls="search-results-panel"
            tabIndex={selected === "all" ? 0 : -1}
            className={selected === "all" ? "active" : ""}
            onClick={() => selectTab("all")}
            onKeyDown={(event) => onTabKeyDown(event, "all")}
          >
            {t("search.all")} {grandTotal}
          </button>
          {visibleKinds.map((kind) => (
            <button
              key={kind}
              id={`search-tab-${kind}`}
              ref={(element) => {
                if (element) tabRefs.current.set(kind, element);
                else tabRefs.current.delete(kind);
              }}
              type="button"
              role="tab"
              aria-selected={selected === kind}
              aria-controls="search-results-panel"
              tabIndex={selected === kind ? 0 : -1}
              className={selected === kind ? "active" : ""}
              onClick={() => selectTab(kind)}
              onKeyDown={(event) => onTabKeyDown(event, kind)}
            >
              {t(`source.${kind}`)} {groups[kind]?.total ?? 0}
            </button>
          ))}
        </nav>
      )}

      {error && (
        <p className="search-error" role="alert">
          {t("search.error")}
        </p>
      )}
      {loading && <p className="muted">{t("search.loading")}</p>}

        {searched && !loading && (
        <div
          id="search-results-panel"
          role={visibleKinds.length > 0 ? "tabpanel" : undefined}
          aria-labelledby={
            visibleKinds.length > 0 ? `search-tab-${selected}` : undefined
          }
          tabIndex={visibleKinds.length > 0 ? 0 : undefined}
        >
          {nothingFound && <p className="muted">{t("search.noResults")}</p>}

          {selected === "all" &&
            visibleKinds.map((kind) => {
              const group = groups[kind];
              if (!group || group.hits.length === 0) return null;
              return (
                <section key={kind}>
                  <div className="search-group-header">
                    <h3 className="search-group">{t(`source.${kind}`)}</h3>
                    <span className="search-count">{group.total}</span>
                    {group.total > group.hits.length && (
                      <button
                        type="button"
                        className="search-see-all"
                        onClick={() => selectTab(kind)}
                      >
                        {t("search.seeAll", { total: group.total })}
                      </button>
                    )}
                  </div>
                  {resultList(group.hits, kind)}
                </section>
              );
            })}

          {selected !== "all" &&
            groups[selected] &&
            (() => {
              const group = groups[selected]!;
              return (
                <section>
                  <div className="search-group-header">
                    <h3 className="search-group">{t(`source.${selected}`)}</h3>
                    <span className="search-count">
                      {t("search.countRange", {
                        from: 1,
                        to: group.hits.length,
                        total: group.total,
                      })}
                    </span>
                  </div>
                  {resultList(group.hits, selected)}
                  {group.hasMore && (
                    <button
                      type="button"
                      className="search-load-more"
                      disabled={loadingMore}
                      onClick={() => loadMore(selected)}
                    >
                      {loadingMore
                        ? t("reader.loading")
                        : t("search.loadMore", { count: PAGE })}
                    </button>
                  )}
                </section>
              );
            })()}
        </div>
        )}
      </div>
    </>
  );
}
