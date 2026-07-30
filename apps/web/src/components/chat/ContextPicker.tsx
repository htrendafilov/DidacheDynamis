import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { findSection, licenceDetail, policyEligible } from "../../chat/context";
import type { ContextChip, LicenceReasonCode } from "../../chat/types";
import type { Work } from "../../data/api";
import { useGeneralBook, usePassage, useWorks } from "../../data/hooks";
import { db } from "../../data/notes";
import type { Note } from "../../data/notes";
import { strongLexiconWorkId } from "../../data/strongs";
import type { Pane } from "../../state/store";

interface Candidate {
  key: string;
  chip: ContextChip;
  label: string;
  defaultOn: boolean;
}

function workById(works: Work[] | null, workId: string | undefined): Work | undefined {
  if (!works || !workId) return undefined;
  return works.find((w) => w.id === workId);
}

// The one place that decides which Work governs a chip's licence and whether it is
// currently eligible. Used both for rendering (disabled + reason) and for emission, so
// the two can never disagree — the bug this replaced was exactly that disagreement:
// a chip could render disabled yet still be reconstructed and emitted regardless.
function chipEligibility(
  chip: ContextChip,
  works: Work[] | null,
  privacyRouting: boolean,
): { eligible: boolean; reason?: LicenceReasonCode } {
  const workId =
    chip.kind === "lexicon"
      ? strongLexiconWorkId(chip.strongId)
      : chip.kind === "xref"
        ? chip.previewWork
        : chip.kind === "note"
          ? undefined
          : chip.workId;
  const work = workById(works, workId);
  if (!work) return { eligible: true };
  const eligible = policyEligible(work.ai_context_policy, privacyRouting);
  return eligible ? { eligible } : { eligible, reason: licenceDetail(work.ai_context_policy, privacyRouting) };
}

function chipKey(chip: ContextChip): string {
  switch (chip.kind) {
    case "bible":
      return `bible:${chip.workId}:${chip.osis}:${chip.chapter}`;
    case "commentary":
      return `commentary:${chip.workId}:${chip.osis}:${chip.chapter}`;
    case "dictionary":
      return `dictionary:${chip.workId}:${chip.headword}`;
    case "lexicon":
      return `lexicon:${chip.strongId}`;
    case "book":
      return `book:${chip.workId}:${chip.sectionId}`;
    case "note":
      return `note:${chip.noteId}`;
    case "xref":
      return `xref:${chip.osis}:${chip.chapter}:${chip.verse}`;
  }
}

// Offers each distinct Strong's id carried by the selected verse's runs, labelled with
// its lemma (m9.3-grounded-assistant.md §5) — "why this word and not a synonym" needs
// real lexical data, not a guess.
function StrongsChips({
  pane,
  works,
  privacyRouting,
  enabled,
  onToggle,
}: {
  pane: Pane;
  works: Work[] | null;
  privacyRouting: boolean;
  enabled: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const passage = usePassage(pane.workId, pane.osis, pane.chapter);
  const verse = pane.selectedVerse;
  const ids = useMemo(() => {
    if (!verse || !passage.data || passage.osis !== pane.osis || passage.chapter !== pane.chapter) {
      return [];
    }
    const v = passage.data.verses.find((entry) => entry.verse === verse);
    if (!v) return [];
    const seen = new Map<string, string>(); // strongId -> a lemma-bearing run's text, for the label
    for (const line of v.lines) {
      for (const run of line.runs) {
        for (const lemma of run.lemma ?? []) {
          if (!seen.has(lemma.id)) seen.set(lemma.id, run.t);
        }
      }
    }
    return [...seen.entries()];
  }, [passage.data, passage.osis, passage.chapter, pane.osis, pane.chapter, verse]);

  if (ids.length === 0) return null;
  return (
    <>
      {ids.map(([strongId, lemma]) => {
        const chip: ContextChip = { kind: "lexicon", strongId };
        const key = chipKey(chip);
        const { eligible, reason } = chipEligibility(chip, works, privacyRouting);
        return (
          <div key={key} className="context-candidate">
            <label className={`context-chip${eligible ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={enabled.has(key) && eligible}
                disabled={!eligible}
                onChange={() => onToggle(key)}
              />
              {t("chat.context.strongsFor", { strongId, lemma })}
            </label>
            {reason && <span className="context-chip-reason">{t(`chat.licence.${reason}`)}</span>}
          </div>
        );
      })}
    </>
  );
}

function NoteChips({
  osis,
  chapter,
  enabled,
  onToggle,
}: {
  osis: string;
  chapter: number;
  enabled: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    let alive = true;
    db.notes
      .where("[osis+chapter]")
      .equals([osis, chapter])
      .toArray()
      .then((found) => {
        if (alive) setNotes(found.filter((n) => n.deletedAt === undefined));
      })
      .catch(() => alive && setNotes([]));
    return () => {
      alive = false;
    };
  }, [osis, chapter]);

  if (notes.length === 0) return null;
  return (
    <fieldset className="context-notes">
      <legend>{t("chat.context.notes")}</legend>
      <p className="context-note-warning">{t("chat.context.noteWarning")}</p>
      {notes.map((note) => {
        const key = chipKey({ kind: "note", noteId: note.id });
        return (
          <label key={key} className="context-chip">
            <input type="checkbox" checked={enabled.has(key)} onChange={() => onToggle(key)} />
            {note.title || t("chat.context.notes")}
          </label>
        );
      })}
    </fieldset>
  );
}

function BookCandidateRow({
  pane,
  works,
  privacyRouting,
  enabled,
  onToggle,
}: {
  pane: Pane;
  works: Work[] | null;
  privacyRouting: boolean;
  enabled: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  const generalBook = useGeneralBook(pane.workId);
  const section =
    pane.sectionId && generalBook.data ? findSection(generalBook.data.sections, pane.sectionId) : null;
  if (!pane.sectionId || !section) return null;
  const chip: ContextChip = { kind: "book", workId: pane.workId, sectionId: pane.sectionId };
  const key = chipKey(chip);
  const work = workById(works, pane.workId);
  const { eligible, reason } = chipEligibility(chip, works, privacyRouting);
  return (
    <div className="context-candidate">
      <label className={`context-chip${eligible ? "" : " disabled"}`}>
        <input
          type="checkbox"
          checked={enabled.has(key) && eligible}
          disabled={!eligible}
          onChange={() => onToggle(key)}
        />
        {section.title} ({work?.abbrev ?? pane.workId})
      </label>
      {reason && <span className="context-chip-reason">{t(`chat.licence.${reason}`)}</span>}
    </div>
  );
}

export function ContextPicker({
  panes,
  privacyRouting,
  loggingConfirmed,
  onChipsChange,
}: {
  panes: Pane[];
  privacyRouting: boolean;
  // Read internally by chipEligibility -> policyEligible -> satisfiesNoTraining, from
  // sessionStorage, not from this prop's value directly. It exists solely so the
  // emission effect below has something to list in its dependency array: React does not
  // know to re-run an effect when a value it reads from storage changes, only when a
  // listed dependency does. Without this, toggling the confirmation checkbox could leave
  // an allowed_no_training chip rendering checked while ChatPanel's emitted chips stayed
  // stale at whatever they were before the toggle.
  loggingConfirmed: boolean;
  onChipsChange: (chips: ContextChip[]) => void;
}) {
  const { t } = useTranslation();
  const works = useWorks();
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [verseEdits, setVerseEdits] = useState<Record<string, string>>({});
  const initialized = useRef(false);

  const paneCandidates = useMemo(() => {
    const list: Candidate[] = [];
    let sawBible = false;
    let sawCommentary = false;
    for (const pane of panes) {
      if (pane.type === "bible") {
        const chip: ContextChip = { kind: "bible", workId: pane.workId, osis: pane.osis, chapter: pane.chapter };
        const key = chipKey(chip);
        const verses = verseEdits[key] ?? (pane.selectedVerse ? String(pane.selectedVerse) : undefined);
        const work = workById(works, pane.workId);
        list.push({
          key,
          chip: { ...chip, verses },
          label: `${pane.osis} ${pane.chapter}${verses ? `:${verses}` : ""} (${work?.abbrev ?? pane.workId})`,
          defaultOn: !sawBible,
        });
        sawBible = true;
      } else if (pane.type === "commentary") {
        const chip: ContextChip = { kind: "commentary", workId: pane.workId, osis: pane.osis, chapter: pane.chapter };
        const work = workById(works, pane.workId);
        list.push({
          key: chipKey(chip),
          chip,
          label: `${work?.abbrev ?? pane.workId} — ${pane.osis} ${pane.chapter}`,
          defaultOn: !sawCommentary,
        });
        sawCommentary = true;
      } else if (pane.type === "dictionary" && pane.headword) {
        const chip: ContextChip = { kind: "dictionary", workId: pane.workId, headword: pane.headword };
        const work = workById(works, pane.workId);
        list.push({
          key: chipKey(chip),
          chip,
          label: `${pane.headword} (${work?.abbrev ?? pane.workId})`,
          defaultOn: false,
        });
      }
    }
    return list;
  }, [panes, works, verseEdits]);

  const bookPanes = panes.filter((p) => p.type === "book" && p.sectionId);
  const bibleishPanes = panes.filter((p) => p.type === "bible" && p.selectedVerse);

  const bibleChapters = useMemo(() => {
    const seen = new Set<string>();
    const list: { osis: string; chapter: number }[] = [];
    for (const pane of panes) {
      if (pane.type !== "bible" && pane.type !== "commentary") continue;
      const key = `${pane.osis}:${pane.chapter}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ osis: pane.osis, chapter: pane.chapter });
    }
    return list;
  }, [panes]);

  // Seed the default-on selection once, the first time real candidates exist. Later pane
  // navigation must not silently re-select or deselect anything the user already chose.
  useEffect(() => {
    if (initialized.current || paneCandidates.length === 0) return;
    initialized.current = true;
    setEnabled(new Set(paneCandidates.filter((c) => c.defaultOn).map((c) => c.key)));
  }, [paneCandidates]);

  const toggle = (key: string) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Every enabled key is re-validated against the *current* works + privacyRouting here,
  // not trusted from whichever subcomponent's checkbox last toggled it. This is what
  // makes turning privacy routing off retroactively drop an allowed_no_training source
  // already staged for the turn (§11) — the subcomponents' disabled states follow from
  // the same chipEligibility call, but the emission does not depend on them agreeing.
  const emittedRef = useRef<string>("");
  useEffect(() => {
    const byKey = new Map(paneCandidates.map((c) => [c.key, c.chip]));
    for (const k of enabled) {
      if (byKey.has(k)) continue;
      if (k.startsWith("lexicon:")) byKey.set(k, { kind: "lexicon", strongId: k.slice("lexicon:".length) });
      else if (k.startsWith("note:")) byKey.set(k, { kind: "note", noteId: k.slice("note:".length) });
      else if (k.startsWith("book:")) {
        const [, workId, sectionId] = k.split(":");
        byKey.set(k, { kind: "book", workId, sectionId });
      }
    }
    const active = [...byKey.entries()]
      .filter(([k]) => enabled.has(k))
      .map(([, chip]) => chip)
      .filter((chip) => chipEligibility(chip, works, privacyRouting).eligible);
    const serialized = JSON.stringify(active);
    if (serialized === emittedRef.current) return;
    emittedRef.current = serialized;
    onChipsChange(active);
    // loggingConfirmed is not read in this body — chipEligibility reads it from
    // sessionStorage via satisfiesNoTraining — but must still be listed so toggling it
    // re-runs this effect and re-emits against the now-current value. See the prop's doc
    // comment above.
  }, [enabled, paneCandidates, works, privacyRouting, loggingConfirmed, onChipsChange]);

  return (
    <fieldset className="context-picker">
      <legend>{t("chat.context.title")}</legend>
      {paneCandidates.map((c) => {
        const { eligible, reason } = chipEligibility(c.chip, works, privacyRouting);
        return (
          <div key={c.key} className="context-candidate">
            <label className={`context-chip${eligible ? "" : " disabled"}`}>
              <input
                type="checkbox"
                checked={enabled.has(c.key) && eligible}
                disabled={!eligible}
                onChange={() => toggle(c.key)}
              />
              {c.label}
            </label>
            {reason && <span className="context-chip-reason">{t(`chat.licence.${reason}`)}</span>}
            {c.chip.kind === "bible" && eligible && (
              <label className="context-verses">
                {t("chat.context.verses")}
                <input
                  type="text"
                  placeholder={t("chat.context.versesPlaceholder")}
                  value={verseEdits[c.key] ?? c.chip.verses ?? ""}
                  onChange={(e) => setVerseEdits((prev) => ({ ...prev, [c.key]: e.target.value }))}
                />
              </label>
            )}
          </div>
        );
      })}
      {bookPanes.map((pane) => (
        <BookCandidateRow
          key={pane.id}
          pane={pane}
          works={works}
          privacyRouting={privacyRouting}
          enabled={enabled}
          onToggle={toggle}
        />
      ))}
      {bibleishPanes.map((pane) => (
        <StrongsChips
          key={pane.id}
          pane={pane}
          works={works}
          privacyRouting={privacyRouting}
          enabled={enabled}
          onToggle={toggle}
        />
      ))}
      {bibleChapters.map(({ osis, chapter }) => (
        <NoteChips key={`${osis}:${chapter}`} osis={osis} chapter={chapter} enabled={enabled} onToggle={toggle} />
      ))}
    </fieldset>
  );
}

export function summarizeContext(
  sourceLabels: string[],
  totalTokens: number,
  droppedCount: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (sourceLabels.length === 0) return t("chat.context.empty");
  const summary = t("chat.context.summary", { labels: sourceLabels.join(", "), tokens: totalTokens });
  return droppedCount > 0 ? `${summary} ${t("chat.context.droppedSummary", { count: droppedCount })}` : summary;
}
