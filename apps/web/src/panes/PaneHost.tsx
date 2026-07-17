import { useTranslation } from "react-i18next";

import { SourceSelector } from "../components/SourceSelector";
import { useStore, type Pane } from "../state/store";
import { BiblePane } from "./BiblePane";
import { CommentaryPane } from "./CommentaryPane";
import { DictionaryPane } from "./DictionaryPane";

// Placeholder for source types arriving in later milestones (commentary/dictionary M3, notes M4).
function PlaceholderPane({ pane }: { pane: Pane }) {
  const { t } = useTranslation();
  const changePaneType = useStore((s) => s.changePaneType);
  return (
    <div className="pane placeholder-pane">
      <div className="pane-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
      </div>
      <div className="pane-body">
        <p className="muted">
          {pane.type === "notes" ? t("notes.comingSoon") : t("source.soon")}
        </p>
      </div>
    </div>
  );
}

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
        <PlaceholderPane pane={pane} />
      )}
    </section>
  );
}
