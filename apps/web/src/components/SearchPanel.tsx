import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, type SearchHit } from "../data/api";
import { useWorks } from "../data/hooks";
import { bookName } from "../i18n/bookNames";
import { useStore } from "../state/store";

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searched, setSearched] = useState(false);
  const goToRef = useStore((s) => s.goToRef);
  const updatePane = useStore((s) => s.updatePane);
  const panes = useStore((s) => s.panes);
  const works = useWorks();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const res = await api.search(q.trim());
    setHits(res.hits);
    setSearched(true);
  }

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
      {searched && hits && hits.length === 0 && <p className="muted">{t("search.noResults")}</p>}
      {hits && hits.length > 0 && (
        <ul className="search-results">
          {hits.map((h) => (
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
                <span
                  className="result-snippet"
                  dangerouslySetInnerHTML={{ __html: h.snippet }}
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
