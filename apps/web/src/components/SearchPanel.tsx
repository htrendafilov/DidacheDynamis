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
}: {
  mode?: "docked" | "fullscreen";
  open?: boolean;
  onNavigate?: (kind: SearchKind) => void;
  onClose: () => void;
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

  // Focus the query field when the workspace opens (the input stays mounted across collapse, so a
  // one-time autoFocus is not enough).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [canon, setCanon] = useState<"" | "ot" | "nt">("");
  const [workFilter, setWorkFilter] = useState<Set<string>>(new Set());
  const [bookFilter, setBookFilter] = useState<Set<string>>(new Set());
  const [bookQuery, setBookQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Selected>("all");
  const [groups, setGroups] = useState<Partial<Record<SearchKind, GroupState>>>({});
  const [searched, setSearched] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!open) setFiltersOpen(false);
  }, [open]);

  useEffect(() => {
    if (!filtersOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
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
      canon: (over.canon ?? canon) || undefined,
      works: effWorks.size ? [...effWorks].join(",") : undefined,
      books: effBooks.size ? [...effBooks].join(",") : undefined,
      types: over.types,
      offset: over.offset,
    };
  }

  async function execute(selection: Selected, o: ReturnType<typeof buildOpts>) {
    const query = q.trim();
    if (!query) return;
    if (selection === "all") {
      const res = await api.search(query, o);
      const map: Partial<Record<SearchKind, GroupState>> = {};
      res.groups.forEach((g) => (map[g.type] = merge(g)));
      setGroups(map);
    } else {
      const res = await api.search(query, { ...o, types: selection, offset: o.offset ?? 0 });
      const g = res.groups[0];
      if (g) setGroups((prev) => ({ ...prev, [selection]: merge(g) }));
    }
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setSelected("all");
    await execute("all", buildOpts());
    setSearched(true);
  }

  function selectTab(next: Selected) {
    setSelected(next);
    if (searched) void execute(next, buildOpts());
  }

  function applyFilter(o: ReturnType<typeof buildOpts>) {
    if (searched) void execute(selected, o);
  }

  function applyCanon(value: "" | "ot" | "nt") {
    setCanon(value);
    applyFilter(buildOpts({ canon: value }));
  }

  function applyWorks(next: Set<string>) {
    setWorkFilter(next);
    applyFilter(buildOpts({ works: next }));
  }

  function applyBooks(next: Set<string>) {
    setBookFilter(next);
    applyFilter(buildOpts({ books: next }));
  }

  function clearFilters() {
    const emptyWorks = new Set<string>();
    const emptyBooks = new Set<string>();
    setCanon("");
    setWorkFilter(emptyWorks);
    setBookFilter(emptyBooks);
    applyFilter(buildOpts({ canon: "", works: emptyWorks, books: emptyBooks }));
  }

  async function loadMore(kind: SearchKind) {
    const current = groups[kind];
    if (!current) return;
    setLoadingMore(true);
    const res = await api.search(q.trim(), buildOpts({ types: kind, offset: current.hits.length }));
    const g = res.groups[0];
    if (g) {
      setGroups((prev) => ({
        ...prev,
        [kind]: { total: g.total, hits: [...current.hits, ...g.hits], hasMore: g.has_more },
      }));
    }
    setLoadingMore(false);
  }

  const grandTotal = KIND_ORDER.reduce((sum, k) => sum + (groups[k]?.total ?? 0), 0);
  const nothingFound = searched && grandTotal === 0;

  function label(hit: SearchHit): string {
    if (hit.kind === "bible")
      return `${bookName(hit.osis, i18n.language, hit.osis)} ${hit.chapter}:${hit.verse}`;
    if (hit.kind === "commentary")
      return `${bookName(hit.osis, i18n.language, hit.osis)} ${hit.chapter}${
        hit.verse_start ? `:${hit.verse_start}` : ""
      }`;
    return hit.title;
  }

  function openHit(hit: SearchHit) {
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
              onClick={() => openHit(hit)}
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

  const visibleKinds = KIND_ORDER.filter((k) => (groups[k]?.total ?? 0) > 0);
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
  const activeFilterCount = (canon ? 1 : 0) + workFilter.size + bookFilter.size;

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
                  applyFilter(buildOpts({ sort: value }));
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
    <div className={`search-panel search-panel-${mode}`}>
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
          placeholder={t("search.placeholder")}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">{t("topbar.search")}</button>
      </form>

      {searched && mode === "docked" && (
        <div className="search-filters">{filterControls()}</div>
      )}

      {searched && mode === "fullscreen" && (
        <div className="search-filter-toolbar">
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(true)}
          >
            ☷ {t("search.filters")}
            {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        </div>
      )}

      {searched && activeFilterCount > 0 && (
        <div className="search-filter-chips" aria-label={t("search.activeFilters")}>
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
            aria-label={t("search.closeFilters")}
            onClick={() => setFiltersOpen(false)}
          />
          <section
            className="search-filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("search.filters")}
          >
            <header>
              <h3>{t("search.filters")}</h3>
              <button
                type="button"
                aria-label={t("search.closeFilters")}
                onClick={() => setFiltersOpen(false)}
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
            type="button"
            role="tab"
            aria-selected={selected === "all"}
            className={selected === "all" ? "active" : ""}
            onClick={() => selectTab("all")}
          >
            {t("search.all")} {grandTotal}
          </button>
          {visibleKinds.map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={selected === kind}
              className={selected === kind ? "active" : ""}
              onClick={() => selectTab(kind)}
            >
              {t(`source.${kind}`)} {groups[kind]?.total ?? 0}
            </button>
          ))}
        </nav>
      )}

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
                  <button type="button" className="search-see-all" onClick={() => selectTab(kind)}>
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
                  {t("search.countRange", { from: 1, to: group.hits.length, total: group.total })}
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
                  {loadingMore ? t("reader.loading") : t("search.loadMore", { count: PAGE })}
                </button>
              )}
            </section>
          );
        })()}
    </div>
  );
}
