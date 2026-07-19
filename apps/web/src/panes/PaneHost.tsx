import { useTranslation } from "react-i18next";

import { useStore, type Pane } from "../state/store";
import { BiblePane } from "./BiblePane";
import { CommentaryPane } from "./CommentaryPane";
import { DictionaryPane } from "./DictionaryPane";
import { NotesPane } from "./NotesPane";

export function PaneHost({ pane }: { pane: Pane }) {
  const removePane = useStore((s) => s.removePane);
  const panes = useStore((s) => s.panes);
  const { t } = useTranslation();
  return (
    <section className="pane-wrap">
      {panes.length > 1 && (
        <button
          type="button"
          className="pane-close"
          aria-label={t("pane.remove")}
          onClick={() => removePane(pane.id)}
        >
          ✕
        </button>
      )}
      {pane.type === "bible" ? (
        <BiblePane pane={pane} />
      ) : pane.type === "commentary" ? (
        <CommentaryPane pane={pane} />
      ) : pane.type === "dictionary" ? (
        <DictionaryPane pane={pane} />
      ) : (
        <NotesPane pane={pane} />
      )}
    </section>
  );
}
