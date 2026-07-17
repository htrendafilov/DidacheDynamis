import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PassageSelector } from "../components/PassageSelector";
import { SourceSelector } from "../components/SourceSelector";
import { useBooks, usePassage, useWorks } from "../data/hooks";
import { CIRRenderer } from "../render/CIRRenderer";
import { useStore, type Pane } from "../state/store";

export function BiblePane({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const settings = useStore((s) => s.settings);
  const updatePane = useStore((s) => s.updatePane);
  const goToRef = useStore((s) => s.goToRef);

  const books = useBooks(pane.workId);
  const works = useWorks();
  const work = works?.find((w) => w.id === pane.workId);
  const { loading, error, data } = usePassage(pane.workId, pane.osis, pane.chapter);

  const { prev, next } = useMemo(() => {
    if (!books) return { prev: null, next: null };
    const idx = books.findIndex((b) => b.osis === pane.osis);
    const book = books[idx];
    if (!book) return { prev: null, next: null };
    const next =
      pane.chapter < book.chapter_count
        ? { osis: pane.osis, chapter: pane.chapter + 1 }
        : idx + 1 < books.length
          ? { osis: books[idx + 1].osis, chapter: 1 }
          : null;
    const prev =
      pane.chapter > 1
        ? { osis: pane.osis, chapter: pane.chapter - 1 }
        : idx - 1 >= 0
          ? { osis: books[idx - 1].osis, chapter: books[idx - 1].chapter_count }
          : null;
    return { prev, next };
  }, [books, pane.osis, pane.chapter]);

  const change = (osis: string, chapter: number) => goToRef(osis, chapter, pane.id);

  return (
    <div className="pane bible-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => updatePane(pane.id, { type })} />
        <PassageSelector
          workId={pane.workId}
          osis={pane.osis}
          chapter={pane.chapter}
          onChange={change}
        />
        <div className="nav-buttons">
          <button
            type="button"
            disabled={!prev}
            onClick={() => prev && change(prev.osis, prev.chapter)}
            aria-label="previous chapter"
          >
            ‹
          </button>
          <button
            type="button"
            disabled={!next}
            onClick={() => next && change(next.osis, next.chapter)}
            aria-label="next chapter"
          >
            ›
          </button>
        </div>
      </div>

      <div className="pane-body">
        {loading && <p className="muted">{t("reader.loading")}</p>}
        {error && <p className="muted">{t("reader.error")}</p>}
        {data && (
          <CIRRenderer
            verses={data.verses}
            headings={data.headings}
            layout={settings.verseLayout}
            wordsOfChrist={settings.wordsOfChrist}
          />
        )}
      </div>

      {work && <div className="pane-footer">{work.attribution}</div>}
    </div>
  );
}
