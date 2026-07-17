import { useTranslation } from "react-i18next";

import { PassageSelector } from "../components/PassageSelector";
import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import { useBooks, useCommentary, useWorks } from "../data/hooks";
import { DocumentRenderer } from "../render/DocumentRenderer";
import { useStore, type Pane } from "../state/store";

export function CommentaryPane({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const changePaneType = useStore((state) => state.changePaneType);
  const goToRef = useStore((state) => state.goToRef);
  const works = useWorks();
  const work = works?.find((item) => item.id === pane.workId);
  const books = useBooks(pane.workId);
  const { loading, error, data } = useCommentary(pane.workId, pane.osis, pane.chapter);

  return (
    <div className="pane commentary-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        <PassageSelector
          workId={pane.workId}
          osis={pane.osis}
          chapter={pane.chapter}
          onChange={(osis, chapter) => goToRef(osis, chapter, pane.id)}
        />
      </div>
      <div className="pane-body">
        {loading && <p className="muted">{t("reader.loading")}</p>}
        {error && <p className="muted">{t("commentary.error")}</p>}
        {data && data.entries.length === 0 && (
          <p className="muted">{t("commentary.noEntries")}</p>
        )}
        {data?.entries.map((entry, index) => (
          <article className="commentary-entry" key={index}>
            {entry.verse_start !== null && (
              <div className="study-ref">
                {entry.verse_start}
                {entry.verse_end !== null && entry.verse_end !== entry.verse_start
                  ? `–${entry.verse_end}`
                  : ""}
              </div>
            )}
            <DocumentRenderer document={entry.body} />
          </article>
        ))}
      </div>
      {work && <WorkFooter work={work} books={books} />}
    </div>
  );
}
