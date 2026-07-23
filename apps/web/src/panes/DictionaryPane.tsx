import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import { useDictionaryEntry, useDictionaryHeadwords, useWorks } from "../data/hooks";
import { DocumentRenderer } from "../render/DocumentRenderer";
import { useStore, type Pane } from "../state/store";

export function DictionaryPane({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const changePaneType = useStore((state) => state.changePaneType);
  const [prefix, setPrefix] = useState("");
  const [headword, setHeadword] = useState<string | null>(null);
  const words = useDictionaryHeadwords(pane.workId, prefix);
  const entry = useDictionaryEntry(pane.workId, headword);
  const works = useWorks();
  const work = works?.find((item) => item.id === pane.workId);

  // Navigate to a headword requested from search (pane.headword). Also seed the prefix so the entry
  // shows up in the list; the entry itself loads regardless of the list.
  useEffect(() => {
    if (pane.headword) {
      setHeadword(pane.headword);
      setPrefix(pane.headword.slice(0, 2));
    }
  }, [pane.headword]);

  useEffect(() => {
    // Clear a browsed selection that scrolled out of the current prefix list, but never clobber a
    // headword that was explicitly navigated to (pane.headword) before its list has loaded.
    if (
      headword &&
      headword !== pane.headword &&
      words &&
      !words.some((word) => word.headword === headword)
    ) {
      setHeadword(null);
    }
  }, [words, headword, pane.headword]);

  return (
    <div className="pane dictionary-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        <input
          type="search"
          value={prefix}
          aria-label={t("dictionary.search")}
          placeholder={t("dictionary.search")}
          onChange={(event) => setPrefix(event.target.value)}
        />
      </div>
      <div className="dictionary-layout">
        <nav className="headword-list" aria-label={t("dictionary.headwords")}>
          {words?.map((word) => (
            <button
              type="button"
              className={word.headword === headword ? "active" : ""}
              key={word.headword}
              onClick={() => setHeadword(word.headword)}
            >
              {word.headword}
            </button>
          ))}
        </nav>
        <div className="pane-body dictionary-entry">
          {!headword && <p className="muted">{t("dictionary.choose")}</p>}
          {headword && !entry && <p className="muted">{t("reader.loading")}</p>}
          {entry && (
            <article>
              <h3>{entry.headword}</h3>
              <DocumentRenderer document={entry.body} />
            </article>
          )}
        </div>
      </div>
      {work && <WorkFooter work={work} />}
    </div>
  );
}
