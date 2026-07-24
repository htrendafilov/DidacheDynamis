// Renders canonical verse content. Verse-per-line vs flowing is a layout choice over the
// same data; words-of-Christ styling is driven by the container's data-woc attribute (CSS).
import type { Heading, Line, Run, Verse } from "../data/api";
import type { VerseLayout, WordsOfChrist } from "../state/store";

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.wj ? (
          <span key={i} className="woj">
            {r.t}
          </span>
        ) : (
          <span key={i}>{r.t}</span>
        ),
      )}
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

function PerLine({
  verses,
  headings,
  onVerseClick,
}: {
  verses: Verse[];
  headings: Heading[];
  onVerseClick?: (verse: number) => void;
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
              {i === 0 && <VNum n={v.verse} onClick={onVerseClick} />} <Runs runs={ln.runs} />
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
}: {
  verses: Verse[];
  headings: Heading[];
  onVerseClick?: (verse: number) => void;
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
              <Runs runs={b.runs} />
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
                <Runs runs={s.runs} />
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
  onVerseClick,
}: {
  verses: Verse[];
  headings: Heading[];
  layout: VerseLayout;
  wordsOfChrist: WordsOfChrist;
  onVerseClick?: (verse: number) => void;
}) {
  return (
    <div className="reader" data-woc={wordsOfChrist} data-layout={layout}>
      {layout === "per-line" ? (
        <PerLine verses={verses} headings={headings} onVerseClick={onVerseClick} />
      ) : (
        <Flowing verses={verses} headings={headings} onVerseClick={onVerseClick} />
      )}
    </div>
  );
}
