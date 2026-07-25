import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { api, type Passage } from "../data/api";
import { bookName } from "../i18n/bookNames";
import { useStore } from "../state/store";

// Previews always come from the public-domain English Bible, which is always installed (matches the
// cross-reference preview default). The pop-up is a reading aid; "open in Bible pane" uses the
// reader's own chosen translation.
const PREVIEW_WORK = "web";
const MAX_PREVIEW_CHARS = 320;
// A chapter-only ref previews its opening verses rather than downloading the whole chapter —
// Psalm 119 is 176 verses, and this fires on hover. Six verses usually exceed the character budget
// above; when they do not, previewText marks the preview as truncated instead.
const CHAPTER_PREVIEW_VERSES = 6;

export interface ParsedScriptureRef {
  osis: string;
  chapter: number;
  start: number | null; // null = chapter-only ref (e.g. "Num.12"); never pretend verse 1
  end: number | null;
}

export function parseScriptureRef(value: string): ParsedScriptureRef | null {
  const chapterOnly = /^([A-Za-z0-9]+)\.(\d+)$/.exec(value);
  if (chapterOnly) {
    const chapter = Number(chapterOnly[2]);
    if (chapter < 1) return null;
    return { osis: chapterOnly[1], chapter, start: null, end: null };
  }
  const match = /^([A-Za-z0-9]+)\.(\d+)\.(\d+)(?:-(\d+))?$/.exec(value);
  if (!match) return null;
  const chapter = Number(match[2]);
  const start = Number(match[3]);
  const end = match[4] ? Number(match[4]) : start;
  if (chapter < 1 || start < 1 || end < start) return null;
  return { osis: match[1], chapter, start, end };
}

function previewText(passage: Passage, windowed: boolean): string {
  const verses = passage.verses.map((verse) => {
    const text = verse.lines
      .map((line) => line.runs.map((run) => run.t).join(""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return `${verse.verse} ${text}`;
  });
  const joined = verses.join(" ").trim();
  if (joined.length > MAX_PREVIEW_CHARS) {
    return `${joined.slice(0, MAX_PREVIEW_CHARS).trimEnd()}…`;
  }
  // A full window came back, so the chapter continues past what was fetched. (A chapter of
  // exactly CHAPTER_PREVIEW_VERSES verses gets a harmless trailing ellipsis; the alternative
  // is fetching the whole chapter just to learn where it ends.)
  return windowed && passage.verses.length >= CHAPTER_PREVIEW_VERSES ? `${joined} …` : joined;
}

export function ScriptureRef({ refValue, children }: { refValue: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  // Memoized on the ref string: a fresh object each render would re-fire the fetch effect on
  // every re-render that happens while a preview is still in flight.
  const parsed = useMemo(() => parseScriptureRef(refValue), [refValue]);
  const goToRef = useStore((state) => state.goToRef);
  const hasBiblePane = useStore((state) => state.panes.some((pane) => pane.type === "bible"));
  const biblePaneId = useStore((state) => state.panes.find((pane) => pane.type === "bible")?.id);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Passage | null>(null);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open || !parsed || data || error) return;
    let alive = true;
    const range =
      parsed.start === null
        ? `1-${CHAPTER_PREVIEW_VERSES}`
        : parsed.start === parsed.end
          ? `${parsed.start}`
          : `${parsed.start}-${parsed.end}`;
    api
      .passage(PREVIEW_WORK, parsed.osis, parsed.chapter, range)
      .then((passage) => alive && setData(passage))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [open, parsed, data, error]);

  // A ref we could not parse (or an unknown book) is shown as plain text — never a dead control.
  if (!parsed) return <>{children}</>;

  const label =
    parsed.start === null
      ? `${bookName(parsed.osis, i18n.language, parsed.osis)} ${parsed.chapter}`
      : `${bookName(parsed.osis, i18n.language, parsed.osis)} ${parsed.chapter}:${parsed.start}${
          parsed.end !== parsed.start ? `-${parsed.end}` : ""
        }`;

  return (
    <span
      className="scripture-ref-wrap"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!wrapRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        // Focus is already within the wrapper when Escape is reachable, so just close — moving
        // focus back to the trigger would re-fire its onFocus and immediately reopen the pop-up.
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="scripture-ref"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
      >
        {children}
      </button>
      {open && (
        <span id={popoverId} role="group" aria-label={label} className="scripture-ref-popover">
          <span className="scripture-ref-popover-title">{label}</span>
          {error && <span className="muted">{t("scriptureRef.error")}</span>}
          {!error && !data && <span className="muted">{t("reader.loading")}</span>}
          {data && (
            <span className="scripture-ref-text">{previewText(data, parsed.start === null)}</span>
          )}
          {data && hasBiblePane && (
            <button
              type="button"
              className="scripture-ref-open"
              onClick={() => {
                goToRef(parsed.osis, parsed.chapter, biblePaneId);
                setOpen(false);
              }}
            >
              {t("scriptureRef.openInBible")}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
