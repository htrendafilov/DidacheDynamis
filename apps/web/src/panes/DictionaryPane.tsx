import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SourceSelector } from "../components/SourceSelector";
import { WorkFooter } from "../components/WorkFooter";
import {
  useDictionaryEntry,
  useDictionaryHeadwords,
  useStrongEntry,
  useWorks,
} from "../data/hooks";
import { normalizeStrongId } from "../data/strongs";
import type { StrongEntry, Work } from "../data/api";
import { DocumentRenderer } from "../render/DocumentRenderer";
import { useStore, type Pane } from "../state/store";

// The Dictionary pane is the app's one reference-lookup surface: Easton headwords for
// type="dictionary" works, Strong's entries for type="lexicon" works (M8.3 hand-off from
// the reader popover and from see-also links inside an entry).
export function DictionaryPane({ pane }: { pane: Pane }) {
  const works = useWorks();
  const work = works?.find((item) => item.id === pane.workId);
  if (work?.type === "lexicon") return <LexiconPane pane={pane} work={work} />;
  return <EastonDictionaryPane pane={pane} work={work} />;
}

function LexiconPane({ pane, work }: { pane: Pane; work: Work }) {
  const { t } = useTranslation();
  const changePaneType = useStore((state) => state.changePaneType);
  const updatePane = useStore((state) => state.updatePane);
  const entry = useStrongEntry(pane.headword ?? null);
  const [draft, setDraft] = useState(pane.headword ?? "");

  // Keep the input in sync with navigations (popover hand-off, see-also links).
  useEffect(() => {
    setDraft(pane.headword ?? "");
  }, [pane.headword]);

  const navigate = (value: string) => {
    const normalized = normalizeStrongId(value);
    if (normalized && normalized !== pane.headword) {
      updatePane(pane.id, { headword: normalized });
    }
  };

  return (
    <div className="pane dictionary-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        <input
          type="search"
          value={draft}
          aria-label={t("dictionary.search")}
          placeholder={t("strongs.idPlaceholder")}
          onChange={(event) => {
            setDraft(event.target.value);
            navigate(event.target.value);
          }}
        />
      </div>
      <div className="pane-body dictionary-entry">
        {!pane.headword && <p className="muted">{t("strongs.choose")}</p>}
        {pane.headword && entry.loading && <p className="muted">{t("reader.loading")}</p>}
        {pane.headword && entry.notFound && <p className="muted">{t("strongs.noEntry")}</p>}
        {pane.headword && entry.error && <p className="muted">{t("strongs.error")}</p>}
        {entry.data && (
          <StrongEntryView
            entry={entry.data}
            onSee={(id) => updatePane(pane.id, { headword: id })}
          />
        )}
      </div>
      <WorkFooter work={work} />
    </div>
  );
}

function StrongEntryView({
  entry,
  onSee,
}: {
  entry: StrongEntry;
  onSee: (strongId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <article className="strongs-lexicon-entry">
      <h3>
        {entry.strong_id} · {entry.lemma}
      </h3>
      {entry.transliteration && (
        <p>
          <span className="strongs-field-label muted">{t("strongs.transliteration")}</span>{" "}
          {entry.transliteration}
        </p>
      )}
      {entry.pronunciation && (
        <p>
          <span className="strongs-field-label muted">{t("strongs.pronunciation")}</span>{" "}
          {entry.pronunciation}
        </p>
      )}
      {entry.definition.split("\n").map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
      {entry.see.length > 0 && (
        <p>
          <span className="strongs-field-label muted">{t("strongs.seeAlso")}</span>{" "}
          {entry.see.map((id) => (
            <button
              key={id}
              type="button"
              className="scripture-ref dictionary-ref"
              aria-label={t("strongs.openEntry", { id })}
              onClick={() => onSee(id)}
            >
              {id}
            </button>
          ))}
        </p>
      )}
    </article>
  );
}

function EastonDictionaryPane({ pane, work }: { pane: Pane; work: Work | undefined }) {
  const { t } = useTranslation();
  const changePaneType = useStore((state) => state.changePaneType);
  const updatePane = useStore((state) => state.updatePane);
  const [prefix, setPrefix] = useState("");
  const [headword, setHeadword] = useState<string | null>(null);
  const words = useDictionaryHeadwords(pane.workId, prefix);
  const entry = useDictionaryEntry(pane.workId, headword);

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
          {headword && entry.loading && <p className="muted">{t("reader.loading")}</p>}
          {headword && entry.error && <p className="muted">{t("dictionary.notFound")}</p>}
          {entry.data && (
            <article>
              <h3>{entry.data.headword}</h3>
              <DocumentRenderer
                document={entry.data.body}
                onDictionaryNavigate={(target) => {
                  setHeadword(target.headword);
                  setPrefix(target.headword.slice(0, 2));
                  updatePane(pane.id, { headword: target.headword });
                }}
              />
            </article>
          )}
        </div>
      </div>
      {work && <WorkFooter work={work} />}
    </div>
  );
}
