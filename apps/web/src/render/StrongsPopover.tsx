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
  id,
  anchor,
  lemmas,
  onClose,
}: {
  id: string;
  anchor: HTMLElement;
  lemmas: RunLemma[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const openDictionary = useStore((state) => state.openDictionary);
  const [results, setResults] = useState<
    { entry: StrongEntry | null; error: boolean }[] | null
  >(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let alive = true;
    setResults(null);
    void Promise.all(
      lemmas.map(async (lemma) => {
        try {
          return { entry: await strongEntry(lemma.id), error: false };
        } catch {
          return { entry: null, error: true };
        }
      }),
    ).then((loaded) => {
      if (alive) setResults(loaded);
    });
    return () => {
      alive = false;
    };
  }, [lemmas]);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    let frame = 0;

    const position = () => {
      frame = 0;
      const anchorRect = anchor.getBoundingClientRect();
      // jsdom and other non-layout renderers report zero-sized client rects. Keep the
      // popover available to accessibility/tests there; real browsers provide geometry.
      if (anchorRect.width === 0 && anchorRect.height === 0) {
        popover.style.visibility = "visible";
        return;
      }
      const boundary = visibleBoundary(anchor);
      popover.style.setProperty(
        "--scripture-popover-boundary-width",
        `${boundary.width}px`,
      );
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
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };

    // Same tracking as the scripture pop-up: a keyboard-opened popover must follow its
    // word when the pane scrolls or the viewport changes.
    position();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(anchor);
    observer?.observe(popover);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer?.disconnect();
    };
  }, [anchor, results]);

  const title = lemmas.map((lemma) => lemma.id).join(", ");
  return (
    <span
      id={id}
      ref={popoverRef}
      role="group"
      aria-label={title}
      className="strongs-popover"
      style={{ visibility: "hidden" }}
    >
      {results === null && <span className="muted">{t("reader.loading")}</span>}
      {results?.map((result, index) => {
        const lemma = lemmas[index];
        const { entry, error } = result;
        return (
          <span className="strongs-entry" key={`${lemma.id}-${index}`}>
            <span className="strongs-id">{lemma.id}</span>
            {error && <span className="muted">{t("strongs.error")}</span>}
            {!error && !entry && <span className="muted">{t("strongs.noEntry")}</span>}
            {lemma.m && (
              <span className="strongs-morph muted">
                {lemma.s
                  ? t("strongs.morphology", { scheme: lemma.s })
                  : t("strongs.morphologyPlain")}
                : {lemma.m}
              </span>
            )}
            {entry && (
              <>
                <span className="strongs-lemma">{entry.lemma}</span>
                {(entry.transliteration || entry.pronunciation) && (
                  <span className="strongs-forms muted">
                    {[entry.transliteration, entry.pronunciation].filter(Boolean).join(" · ")}
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
