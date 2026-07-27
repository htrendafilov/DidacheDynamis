// The single shared Strong's lexicon popover for one rendered chapter (M8.3). CIRRenderer
// delegates all word interaction here instead of mounting a component per tagged word —
// the plan's rendering-cost constraint for long chapters (Psalm 119).
//
// Shape follows the Easton scripture pop-up (ScriptureRef) so there is one interaction
// language for reference lookups: same fixed card, same boundary fitting, same
// open-in-pane hand-off. Morphology comes from the verse occurrence (RunLemma.s/m), the
// entry content from /lexicon/{id}; a 404 (module key hole) is a clean miss.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { calculatePopoverPosition, visibleBoundary } from "../components/ScriptureRef";
import type { RunLemma, StrongEntry } from "../data/api";
import { strongEntry } from "../data/hooks";
import { useStore } from "../state/store";

const MAX_DEFINITION_CHARS = 320;

function shortDefinition(text: string): string {
  return text.length > MAX_DEFINITION_CHARS
    ? `${text.slice(0, MAX_DEFINITION_CHARS).trimEnd()}…`
    : text;
}

export function StrongsPopover({
  anchor,
  lemmas,
  onClose,
}: {
  anchor: HTMLElement;
  lemmas: RunLemma[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const openDictionary = useStore((state) => state.openDictionary);
  const [entries, setEntries] = useState<(StrongEntry | null)[] | null>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    void Promise.all(lemmas.map((lemma) => strongEntry(lemma.id))).then((results) => {
      if (alive) setEntries(results);
    });
    return () => {
      alive = false;
    };
  }, [lemmas]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const anchorRect = anchor.getBoundingClientRect();
    // jsdom and other non-layout renderers report zero-sized client rects. Keep the popover
    // available to accessibility/tests there; real browsers always provide geometry.
    if (anchorRect.width === 0 && anchorRect.height === 0) {
      popover.style.visibility = "visible";
      return;
    }
    const boundary = visibleBoundary(anchor);
    popover.style.setProperty("--scripture-popover-boundary-width", `${boundary.width}px`);
    popover.style.maxHeight = `${boundary.height}px`;
    const placement = calculatePopoverPosition(
      anchorRect,
      boundary,
      popover.getBoundingClientRect(),
    );
    popover.style.top = `${placement.top}px`;
    popover.style.left = `${placement.left}px`;
    popover.style.maxHeight = `${placement.maxHeight}px`;
    popover.style.visibility = "visible";
    popover.dataset.placement = placement.placement;
  }, [anchor, entries]);

  const title = lemmas.map((lemma) => lemma.id).join(", ");
  return (
    <span
      ref={popoverRef}
      role="group"
      aria-label={title}
      className="strongs-popover"
      style={{ visibility: "hidden" }}
    >
      {entries === null && <span className="muted">{t("reader.loading")}</span>}
      {entries?.map((entry, index) => {
        const lemma = lemmas[index];
        return (
          <span className="strongs-entry" key={`${lemma.id}-${index}`}>
            <span className="strongs-id">{lemma.id}</span>
            {!entry && <span className="muted">{t("strongs.noEntry")}</span>}
            {entry && (
              <>
                <span className="strongs-lemma">{entry.lemma}</span>
                {(entry.transliteration || entry.pronunciation) && (
                  <span className="strongs-forms muted">
                    {[entry.transliteration, entry.pronunciation].filter(Boolean).join(" · ")}
                  </span>
                )}
                {lemma.m && (
                  <span className="strongs-morph muted">
                    {lemma.s
                      ? t("strongs.morphology", { scheme: lemma.s })
                      : t("strongs.morphologyPlain")}
                    : {lemma.m}
                  </span>
                )}
                <span className="strongs-definition">{shortDefinition(entry.definition)}</span>
                <button
                  type="button"
                  className="strongs-open"
                  onClick={() => {
                    openDictionary(entry.work_id, entry.strong_id);
                    onClose();
                  }}
                >
                  {t("strongs.openInDictionary")}
                </button>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}
