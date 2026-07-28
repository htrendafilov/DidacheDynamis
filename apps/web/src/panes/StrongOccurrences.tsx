import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  api,
  type StrongsOccurrenceHit,
  type StrongOccurrenceResponse,
} from "../data/api";
import { useBooks, useStrongSources, useWorks } from "../data/hooks";
import { bookName } from "../i18n/bookNames";
import { useStore } from "../state/store";

const PAGE = 50;

export function StrongOccurrences({
  strongId,
  preservePaneId,
}: {
  strongId: string;
  preservePaneId: string;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const sources = useStrongSources();
  const works = useWorks();
  const [source, setSource] = useState("");
  const [canon, setCanon] = useState<"" | "ot" | "nt">("");
  const [book, setBook] = useState("");
  const effectiveSource =
    source || (sources?.length === 1 ? sources[0].work_id : "");
  const sourcesReady = sources !== null;
  const bookSource = effectiveSource || sources?.[0]?.work_id || "kjv";
  const books = useBooks(bookSource);
  const openOccurrence = useStore((state) => state.openStrongsOccurrence);
  const requestId = useRef(0);
  const [result, setResult] = useState<StrongOccurrenceResponse | null>(null);
  const [hits, setHits] = useState<StrongsOccurrenceHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const options = useCallback(
    (offset: number) => ({
      works: effectiveSource || undefined,
      canon: canon || undefined,
      books: book || undefined,
      limit: PAGE,
      offset,
    }),
    [effectiveSource, canon, book],
  );

  useEffect(() => {
    if (!sourcesReady) return;
    const current = ++requestId.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    setHits([]);
    setResult(null);
    api
      .strongOccurrences(strongId, options(0))
      .then((response) => {
        if (current !== requestId.current) return;
        setResult(response);
        setHits(response.hits);
      })
      .catch(() => {
        if (current === requestId.current) setError(true);
      })
      .finally(() => {
        if (current === requestId.current) setLoading(false);
      });
  }, [strongId, options, sourcesReady]);

  const loadMore = async () => {
    if (!result || loadingMore) return;
    const current = ++requestId.current;
    setLoadingMore(true);
    setError(false);
    try {
      const response = await api.strongOccurrences(
        strongId,
        options(hits.length),
      );
      if (current !== requestId.current) return;
      setResult(response);
      setHits((currentHits) => [...currentHits, ...response.hits]);
    } catch {
      if (current === requestId.current) setError(true);
    } finally {
      if (current === requestId.current) setLoadingMore(false);
    }
  };

  return (
    <section className="strongs-occurrences" aria-labelledby={titleId}>
      <h4 id={titleId}>{t("strongs.occurrences")}</h4>
      <div className="strongs-occurrence-filters">
        {sources && sources.length > 1 && (
          <label>
            <span>{t("search.sources")}</span>
            <select
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setBook("");
              }}
            >
              <option value="">{t("search.allSources")}</option>
              {sources.map(({ work_id: workId }) => (
                <option key={workId} value={workId}>
                  {works?.find((work) => work.id === workId)?.abbrev ??
                    workId.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          <span>{t("search.testament")}</span>
          <select
            value={canon}
            onChange={(event) =>
              setCanon(event.target.value as "" | "ot" | "nt")
            }
          >
            <option value="">{t("search.testAll")}</option>
            <option value="ot">{t("search.testOt")}</option>
            <option value="nt">{t("search.testNt")}</option>
          </select>
        </label>
        <label>
          <span>{t("search.books")}</span>
          <select value={book} onChange={(event) => setBook(event.target.value)}>
            <option value="">{t("search.allBooks")}</option>
            {books?.map((value) => (
              <option key={value.osis} value={value.osis}>
                {bookName(value.osis, i18n.language, value.name)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p className="muted">{t("reader.loading")}</p>}
      {error && (
        <p className="search-error" role="alert">
          {t("strongs.occurrencesError")}
        </p>
      )}
      {!loading && result && (
        <p className="muted">
          {t("strongs.occurrenceSummary", {
            occurrences: result.occurrence_total,
            verses: result.total,
          })}
        </p>
      )}
      {!loading && result?.total === 0 && (
        <p className="muted">{t("strongs.noOccurrences")}</p>
      )}
      {hits.length > 0 && (
        <ul className="strongs-occurrence-list">
          {hits.map((hit) => (
            <li key={`${hit.work_id}-${hit.strong_id}-${hit.ref}`}>
              <button
                type="button"
                onClick={() =>
                  openOccurrence(
                    hit.work_id,
                    hit.osis,
                    hit.chapter,
                    hit.verse,
                    hit.strong_id,
                    preservePaneId,
                  )
                }
              >
                <span className="result-ref">
                  {bookName(hit.osis, i18n.language, hit.osis)} {hit.chapter}:
                  {hit.verse}
                </span>{" "}
                <span className="result-version">
                  {works?.find((work) => work.id === hit.work_id)?.abbrev ??
                    hit.work_id.toUpperCase()}
                </span>
                {hit.occurrence_count > 1 && (
                  <span className="strongs-occurrence-multiple">
                    ×{hit.occurrence_count}
                  </span>
                )}
                <span className="strongs-occurrence-surfaces">
                  {hit.surfaces.filter(Boolean).join(" · ") || hit.strong_id}
                </span>
                <span className="result-snippet">{hit.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {result?.has_more && (
        <button
          type="button"
          className="search-load-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore
            ? t("reader.loading")
            : t("search.loadMore", { count: PAGE })}
        </button>
      )}
    </section>
  );
}
