import { Fragment, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type BookSearchHit, type SearchHit, type SearchSort } from "../data/api";
import { useWorks } from "../data/hooks";
import { bookName } from "../i18n/bookNames";
import { useStore } from "../state/store";

// The API's FTS snippet marks matches with <b>…</b> only. Render it without
// dangerouslySetInnerHTML: split on those markers and let React escape the text,
// so any stray markup in the source can never be interpreted as HTML.
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

interface BibleResults {
  hits: SearchHit[];
  total: number;
  hasMore: boolean;
}

const PAGE = 50;

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [bible, setBible] = useState<BibleResults | null>(null);
  const [bookHits, setBookHits] = useState<BookSearchHit[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const goToRef = useStore((s) => s.goToRef);
  const updatePane = useStore((s) => s.updatePane);
  const openBookSection = useStore((s) => s.openBookSection);
  const panes = useStore((s) => s.panes);
  const works = useWorks();

  function toBible(group: { hits: SearchHit[]; total: number; has_more: boolean } | undefined) {
    return { hits: group?.hits ?? [], total: group?.total ?? 0, hasMore: group?.has_more ?? false };
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    const [res, books] = await Promise.all([
      api.search(query, { sort, limit: PAGE, offset: 0 }),
      api.searchBooks(query),
    ]);
    setBible(toBible(res.groups.find((group) => group.type === "bible")));
    setBookHits(books.hits);
    setSearched(true);
  }

  async function changeSort(next: SearchSort) {
    setSort(next);
    const query = q.trim();
    if (!searched || !query) return;
    const res = await api.search(query, { sort: next, limit: PAGE, offset: 0 });
    setBible(toBible(res.groups.find((group) => group.type === "bible")));
  }

  async function loadMore() {
    const query = q.trim();
    if (!bible || !query) return;
    setLoadingMore(true);
    const res = await api.search(query, { sort, limit: PAGE, offset: bible.hits.length });
    const next = toBible(res.groups.find((group) => group.type === "bible"));
    setBible((prev) =>
      prev ? { hits: [...prev.hits, ...next.hits], total: next.total, hasMore: next.hasMore } : prev,
    );
    setLoadingMore(false);
  }

  const nothingFound = searched && bible?.hits.length === 0 && bookHits?.length === 0;

  return (
    <div className="search-panel">
      <form onSubmit={run} className="search-form">
        <input
          autoFocus
          type="search"
          value={q}
          placeholder={t("search.placeholder")}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit">{t("topbar.search")}</button>
        <button type="button" onClick={onClose} aria-label="close">
          ✕
        </button>
      </form>
      {nothingFound && <p className="muted">{t("search.noResults")}</p>}
      {bible && bible.hits.length > 0 && (
        <>
          <div className="search-group-header">
            <h3 className="search-group">{t("search.bibleResults")}</h3>
            <span className="search-count">
              {t("search.countRange", { from: 1, to: bible.hits.length, total: bible.total })}
            </span>
            <div className="search-sort" role="group" aria-label={t("search.sortLabel")}>
              <button
                type="button"
                className={sort === "relevance" ? "active" : ""}
                aria-pressed={sort === "relevance"}
                onClick={() => changeSort("relevance")}
              >
                {t("search.sortRelevance")}
              </button>
              <button
                type="button"
                className={sort === "canonical" ? "active" : ""}
                aria-pressed={sort === "canonical"}
                onClick={() => changeSort("canonical")}
              >
                {t("search.sortCanonical")}
              </button>
            </div>
          </div>
          <ul className="search-results">
            {bible.hits.map((h) => (
              <li key={`${h.work_id}-${h.ref}`}>
                <button
                  type="button"
                  className="result"
                  onClick={() => {
                    const target =
                      panes.find((pane) => pane.type === "bible" && pane.workId === h.work_id) ??
                      panes.find((pane) => pane.type === "bible");
                    if (target) updatePane(target.id, { workId: h.work_id });
                    goToRef(h.osis, h.chapter, target?.id);
                    onClose();
                  }}
                >
                  <span className="result-ref">
                    {bookName(h.osis, i18n.language, h.osis)} {h.chapter}:{h.verse}
                  </span>{" "}
                  <span className="result-version">
                    {works?.find((work) => work.id === h.work_id)?.abbrev ?? h.work_id.toUpperCase()}
                  </span>{" "}
                  <span className="result-snippet">
                    <Snippet html={h.snippet} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {bible.hasMore && (
            <button
              type="button"
              className="search-load-more"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore ? t("reader.loading") : t("search.loadMore", { count: PAGE })}
            </button>
          )}
        </>
      )}
      {bookHits && bookHits.length > 0 && (
        <>
          <h3 className="search-group">{t("search.bookResults")}</h3>
          <ul className="search-results">
            {bookHits.map((h) => (
              <li key={`${h.work_id}-${h.section_id}`}>
                <button
                  type="button"
                  className="result result-book"
                  onClick={() => {
                    openBookSection(h.work_id, h.section_id);
                    onClose();
                  }}
                >
                  <span className="result-ref">{h.title}</span>{" "}
                  <span className="result-version">
                    {works?.find((work) => work.id === h.work_id)?.abbrev ?? h.work_id.toUpperCase()}
                  </span>{" "}
                  <span className="result-snippet">
                    <Snippet html={h.snippet} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
