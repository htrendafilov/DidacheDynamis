// Renders canonical verse content. Verse-per-line vs flowing is a layout choice over the
// same data; words-of-Christ styling is driven by the container's data-woc attribute (CSS).
//
// Strong's mode (M8.3): when enabled, runs carrying a `lemma` list render as plain button
// elements with a data-strongs index into a per-chapter lemma table, and all interaction is
// delegated to one handler set on the container feeding one shared popover — never a React
// component with its own handlers per word (Psalm 119 has ~850 tagged spans). With the
// toggle off the rendered DOM is byte-for-byte what it was before M8.3.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type KeyboardEvent,
  type FocusEvent,
} from "react";

import type { Heading, Line, Run, RunLemma, Verse } from "../data/api";
import type { VerseLayout, WordsOfChrist } from "../state/store";
import { StrongsPopover } from "./StrongsPopover";

function Runs({
  runs,
  strongsEnabled,
  lemmaIndex,
  activeStrongIdx,
  popoverId,
}: {
  runs: Run[];
  strongsEnabled: boolean;
  lemmaIndex: WeakMap<Run, number>;
  activeStrongIdx: number | null;
  popoverId: string;
}) {
  return (
    <>
      {runs.map((r, i) => {
        const strongsIdx =
          strongsEnabled && r.lemma?.length ? lemmaIndex.get(r) : undefined;
        if (strongsIdx !== undefined) {
          return (
            <button
              key={i}
              type="button"
              data-strongs={strongsIdx}
              className={r.wj ? "strongs-word woj" : "strongs-word"}
              aria-expanded={strongsIdx === activeStrongIdx}
              aria-controls={strongsIdx === activeStrongIdx ? popoverId : undefined}
            >
              {r.t}
            </button>
          );
        }
        return r.wj ? (
          <span key={i} className="woj">
            {r.t}
          </span>
        ) : (
          <span key={i}>{r.t}</span>
        );
      })}
    </>
  );
}

function VNum({ n, onClick }: { n: number; onClick?: (verse: number) => void }) {
  return onClick ? (
    <button type="button" className="vnum" onClick={() => onClick(n)} aria-label={`Verse ${n}`}>
      {n}
    </button>
  ) : (
    <sup className="vnum">{n}</sup>
  );
}

function HeadingView({ h }: { h: Heading }) {
  return <h4 className={`heading ${h.kind}`}>{h.text}</h4>;
}

function headingMap(headings: Heading[]): Map<number, Heading[]> {
  const m = new Map<number, Heading[]>();
  for (const h of headings) {
    const arr = m.get(h.before_verse) ?? [];
    arr.push(h);
    m.set(h.before_verse, arr);
  }
  return m;
}

type RunProps = {
  strongsEnabled: boolean;
  lemmaIndex: WeakMap<Run, number>;
  activeStrongIdx: number | null;
  popoverId: string;
};

function PerLine({
  verses,
  headings,
  onVerseClick,
  runProps,
}: {
  verses: Verse[];
  headings: Heading[];
  onVerseClick?: (verse: number) => void;
  runProps: RunProps;
}) {
  const hmap = headingMap(headings);
  return (
    <>
      {verses.map((v) => (
        <div key={v.verse} className="verse-block" data-verse={v.verse}>
          {(hmap.get(v.verse) ?? []).map((h, i) => (
            <HeadingView key={i} h={h} />
          ))}
          {v.lines.map((ln: Line, i) => (
            <div key={i} className={ln.kind === "q" ? `line q q${ln.level}` : "line p"}>
              {i === 0 && <VNum n={v.verse} onClick={onVerseClick} />}{" "}
              <Runs runs={ln.runs} {...runProps} />
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

type Block =
  | { type: "heading"; h: Heading }
  | { type: "poetry"; level: number; verseNum?: number; runs: Run[] }
  | { type: "para"; segs: { verseNum?: number; runs: Run[] }[] };

function Flowing({
  verses,
  headings,
  onVerseClick,
  runProps,
}: {
  verses: Verse[];
  headings: Heading[];
  onVerseClick?: (verse: number) => void;
  runProps: RunProps;
}) {
  const hmap = headingMap(headings);
  const blocks: Block[] = [];
  let para: Extract<Block, { type: "para" }> | null = null;

  for (const v of verses) {
    for (const h of hmap.get(v.verse) ?? []) {
      para = null;
      blocks.push({ type: "heading", h });
    }
    v.lines.forEach((ln, idx) => {
      const verseNum = idx === 0 ? v.verse : undefined;
      if (ln.kind === "q") {
        para = null;
        blocks.push({ type: "poetry", level: ln.level, verseNum, runs: ln.runs });
      } else {
        if (para === null || (idx === 0 && ln.para_start)) {
          para = { type: "para", segs: [] };
          blocks.push(para);
        }
        para.segs.push({ verseNum, runs: ln.runs });
      }
    });
  }

  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "heading") return <HeadingView key={i} h={b.h} />;
        if (b.type === "poetry")
          return (
            <div key={i} className={`line q q${b.level}`} data-verse={b.verseNum}>
              {b.verseNum !== undefined && (
                <VNum n={b.verseNum} onClick={onVerseClick} />
              )}{" "}
              <Runs runs={b.runs} {...runProps} />
            </div>
          );
        return (
          <p key={i} className="para">
            {b.segs.map((s, j) => (
              <span key={j} data-verse={s.verseNum}>
                {j > 0 ? " " : ""}
                {s.verseNum !== undefined && (
                  <VNum n={s.verseNum} onClick={onVerseClick} />
                )}{" "}
                <Runs runs={s.runs} {...runProps} />
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function CIRRenderer({
  verses,
  headings,
  layout,
  wordsOfChrist,
  strongsEnabled = false,
  onVerseClick,
}: {
  verses: Verse[];
  headings: Heading[];
  layout: VerseLayout;
  wordsOfChrist: WordsOfChrist;
  strongsEnabled?: boolean;
  onVerseClick?: (verse: number) => void;
}) {
  // Per-chapter lemma table in document order; buttons reference it by data-strongs index.
  const lemmas = useMemo(() => {
    const list: RunLemma[][] = [];
    for (const verse of verses)
      for (const line of verse.lines)
        for (const run of line.runs) if (run.lemma?.length) list.push(run.lemma);
    return list;
  }, [verses]);
  const lemmaIndex = useMemo(() => {
    const map = new WeakMap<Run, number>();
    let i = 0;
    for (const verse of verses)
      for (const line of verse.lines)
        for (const run of line.runs) if (run.lemma?.length) map.set(run, i++);
    return map;
  }, [verses]);

  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  // A passage change (including a synced pane navigated without any pointer/focus
  // transition here) must not leave the popover on a stale word/anchor.
  useEffect(() => {
    setActive(null);
    setAnchor(null);
  }, [verses]);

  const openWord = (el: HTMLElement) => {
    const idx = el.dataset.strongs;
    if (idx === undefined) return;
    setActive(Number(idx));
    setAnchor(el);
  };
  const closeWord = () => {
    setActive(null);
    setAnchor(null);
  };
  const staysOpen = (to: EventTarget | null): boolean =>
    to instanceof Node &&
    Boolean(
      (to as HTMLElement).closest?.("[data-strongs]") ||
        (to as HTMLElement).closest?.(".strongs-popover"),
    );
  const wordFrom = (target: EventTarget): HTMLElement | null =>
    target instanceof HTMLElement ? target.closest<HTMLElement>("[data-strongs]") : null;

  const runProps: RunProps = {
    strongsEnabled,
    lemmaIndex,
    activeStrongIdx: active,
    popoverId,
  };
  // The lemma table rebuilds with new verses before the reset effect runs, so validate the
  // index for this commit rather than handing the popover a stale or missing entry.
  const activeLemmas = active !== null ? lemmas[active] : undefined;

  return (
    <div
      ref={rootRef}
      className="reader"
      data-woc={wordsOfChrist}
      data-layout={layout}
      onMouseOver={(e: MouseEvent) => {
        const el = wordFrom(e.target);
        if (el) openWord(el);
      }}
      onMouseOut={(e: MouseEvent) => {
        if (!staysOpen(e.relatedTarget)) closeWord();
      }}
      onFocus={(e: FocusEvent) => {
        const el = wordFrom(e.target);
        if (el) openWord(el);
      }}
      onBlur={(e: FocusEvent) => {
        if (!staysOpen(e.relatedTarget)) closeWord();
      }}
      onClick={(e: MouseEvent) => {
        const el = wordFrom(e.target);
        if (el) {
          // Idempotent: a tap opens and stays open (touch fires mouseover before click,
          // so a toggle would open-then-close in the same tap); tapping a word keeps it.
          openWord(el);
          return;
        }
        closeWord(); // tapping non-word verse text dismisses
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape" && active !== null) {
          e.stopPropagation();
          closeWord();
        }
      }}
    >
      {layout === "per-line" ? (
        <PerLine
          verses={verses}
          headings={headings}
          onVerseClick={onVerseClick}
          runProps={runProps}
        />
      ) : (
        <Flowing
          verses={verses}
          headings={headings}
          onVerseClick={onVerseClick}
          runProps={runProps}
        />
      )}
      {strongsEnabled && anchor && activeLemmas && (
        <StrongsPopover
          id={popoverId}
          anchor={anchor}
          lemmas={activeLemmas}
          onClose={closeWord}
        />
      )}
    </div>
  );
}
