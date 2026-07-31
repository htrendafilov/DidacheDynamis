import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { findSection, licenceDetail, policyEligible } from "../../chat/context";
import type {
  ContextChip,
  DropReason,
  DroppedSource,
  LicenceReasonCode,
  StudySource,
} from "../../chat/types";
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

// A pane chip's identity is the PANE, not the reference the pane currently shows. §5 says
// chips enumerate "every open pane's current reference", so when the reader turns to the
// next chapter the same chip must follow the pane there, still checked.
//
// Keying by workId/osis/chapter instead meant every navigation minted a brand-new key while
// `enabled` still held the old one. Because the default-on seeding runs once (and must, or
// it would resurrect chips the reader deliberately turned off), nothing re-armed the new
// key: from the first chapter turn onward the picker emitted no chips at all and every
// question after that was answered with no context — the exact failure this milestone
// exists to prevent, reached by simply reading on.
const paneChipKey = (pane: Pane) => `pane:${pane.id}`;

// Which reference a pane is showing, used to expire a verse-range edit that was typed for
// a different chapter.
const paneRef = (pane: Pane) => `${pane.osis}:${pane.chapter}`;

interface VerseEdit {
  ref: string;
  verses: string;
}

function workById(works: Work[] | null, workId: string | undefined): Work | undefined {
  if (!works || !workId) return undefined;
  return works.find((w) => w.id === workId);
}

// Which work id(s) govern a chip's licence. Almost every kind depends on exactly one
// work; xref is the exception — context.ts's real builder requires both the TSK-type
// cross-reference work (mirrored here by work type rather than a hardcoded "tsk" id,
// matching how BibleVersionSelector/ReadingSettings/etc. already discover works by type)
// and the preview work to be eligible, since either could leak licensed text into the
// prompt. There is no live xref response here to know in advance whether a preview will
// actually be attached to any reference (context.ts's own gate is conditional on that),
// so both are always required — conservative in the same direction the licence gate
// itself is: a chip may render disabled in a case that would have been fine, never the
// other way around.
function chipWorkIds(chip: ContextChip, works: Work[] | null): (string | undefined)[] {
  switch (chip.kind) {
    case "lexicon":
      return [strongLexiconWorkId(chip.strongId)];
    case "xref":
      return [works?.find((w) => w.type === "xref")?.id, chip.previewWork];
    case "note":
      return [];
    default:
      return [chip.workId];
  }
}

// The one place that decides which Work(s) govern a chip's licence and whether it is
// currently eligible. Used both for rendering (disabled + reason) and for emission, so
// the two can never disagree — the bug this replaced was exactly that disagreement:
// a chip could render disabled yet still be reconstructed and emitted regardless.
function chipEligibility(
  chip: ContextChip,
  works: Work[] | null,
  privacyRouting: boolean,
): { eligible: boolean; reason?: LicenceReasonCode } {
  for (const workId of chipWorkIds(chip, works)) {
    const work = workById(works, workId);
    if (!work) continue; // unknown locally -> not this work's gate to block on
    const eligible = policyEligible(work.ai_context_policy, privacyRouting);
    if (!eligible) return { eligible, reason: licenceDetail(work.ai_context_policy, privacyRouting) };
  }
  return { eligible: true };
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
      return `xref:${chip.previewWork}:${chip.osis}:${chip.chapter}:${chip.verse}`;
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

// Offers a cross-references chip for the selected verse — context.ts fully supports xref
// chips (§4's relevance order even places them ahead of dictionary/book/notes), but until
// now nothing in the picker ever constructed one, so users had no way to reach it. No
// prefetch to check whether cross-references actually exist for this verse: like any
// other chip, if buildContext finds none it is dropped as "unavailable", same as an empty
// dictionary lookup.
function XrefChip({
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
  const verse = pane.selectedVerse;
  if (!verse) return null;
  const chip: ContextChip = {
    kind: "xref",
    osis: pane.osis,
    chapter: pane.chapter,
    verse,
    previewWork: pane.workId,
  };
  const key = chipKey(chip);
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
        {t("chat.context.xrefFor", { osis: pane.osis, chapter: pane.chapter, verse })}
      </label>
      {reason && <span className="context-chip-reason">{t(`chat.licence.${reason}`)}</span>}
    </div>
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
  const [verseEdits, setVerseEdits] = useState<Record<string, VerseEdit>>({});
  const [stripOpen, setStripOpen] = useState(false);
  const initialized = useRef(false);

  const paneCandidates = useMemo(() => {
    const list: Candidate[] = [];
    let sawBible = false;
    let sawCommentary = false;
    for (const pane of panes) {
      const key = paneChipKey(pane);
      const work = workById(works, pane.workId);
      if (pane.type === "bible") {
        // A range typed for John 3 must not silently carry over to John 4; the edit is
        // stamped with the reference it was typed against and ignored once that changes.
        const edit = verseEdits[key];
        const verses =
          edit && edit.ref === paneRef(pane)
            ? edit.verses
            : pane.selectedVerse
              ? String(pane.selectedVerse)
              : undefined;
        list.push({
          key,
          chip: { kind: "bible", workId: pane.workId, osis: pane.osis, chapter: pane.chapter, verses },
          label: `${pane.osis} ${pane.chapter}${verses ? `:${verses}` : ""} (${work?.abbrev ?? pane.workId})`,
          defaultOn: !sawBible,
        });
        sawBible = true;
      } else if (pane.type === "commentary") {
        list.push({
          key,
          chip: { kind: "commentary", workId: pane.workId, osis: pane.osis, chapter: pane.chapter },
          label: `${work?.abbrev ?? pane.workId} — ${pane.osis} ${pane.chapter}`,
          defaultOn: !sawCommentary,
        });
        sawCommentary = true;
      } else if (pane.type === "dictionary" && pane.headword) {
        list.push({
          key,
          chip: { kind: "dictionary", workId: pane.workId, headword: pane.headword },
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

  // The single derivation of "what this turn will carry", used for BOTH the outgoing chip
  // set and the collapsed strip summary. They must not be computed separately: the summary
  // is the only description of scope the reader sees while the strip is collapsed (its
  // default state), so any divergence is the UI misreporting what leaves the browser.
  //
  // Every enabled key is re-validated against the *current* works + privacyRouting here,
  // not trusted from whichever subcomponent's checkbox last toggled it. This is what makes
  // turning privacy routing off retroactively drop an allowed_no_training source already
  // staged for the turn (§11) — the subcomponents' disabled states follow from the same
  // chipEligibility call, but this does not depend on them agreeing.
  const activeContext = useMemo(() => {
    // Referenced, not merely listed: chipEligibility consults the logging confirmation
    // through sessionStorage (the same source context.ts trusts at send time, so the two
    // cannot drift), but React only recomputes a memo for dependencies its body actually
    // reads. Without this the strip and the emitted chips would both go stale the moment
    // the confirmation is toggled — exactly the §11 re-evaluation this exists to guarantee.
    void loggingConfirmed;
    const byKey = new Map<string, ContextChip>(paneCandidates.map((c) => [c.key, c.chip]));
    const labelByKey = new Map(paneCandidates.map((c) => [c.key, c.label]));
    for (const k of enabled) {
      if (byKey.has(k)) continue;
      if (k.startsWith("lexicon:")) byKey.set(k, { kind: "lexicon", strongId: k.slice("lexicon:".length) });
      else if (k.startsWith("note:")) byKey.set(k, { kind: "note", noteId: k.slice("note:".length) });
      else if (k.startsWith("book:")) {
        const [, workId, sectionId] = k.split(":");
        byKey.set(k, { kind: "book", workId, sectionId });
      } else if (k.startsWith("xref:")) {
        const [, previewWork, osis, chapter, verse] = k.split(":");
        byKey.set(k, { kind: "xref", previewWork, osis, chapter: Number(chapter), verse: Number(verse) });
      }
    }

    const chips: ContextChip[] = [];
    const labels: string[] = [];
    let unlabelled = 0; // lexicon/xref/note/book chips are labelled in their own
    // subcomponents, not here; they are counted rather than relabelled.
    for (const [key, chip] of byKey) {
      // A key can outlive what produced it — a closed pane, or a lexicon/xref chip whose
      // verse-scoped key went stale when the reader navigated. Those keys stay in
      // `enabled` but have no candidate, so they must not be described as being sent.
      if (!enabled.has(key)) continue;
      if (!chipEligibility(chip, works, privacyRouting).eligible) continue;
      chips.push(chip);
      const label = labelByKey.get(key);
      if (label) labels.push(label);
      else unlabelled++;
    }
    return { chips, labels, unlabelled };
    // loggingConfirmed is not read in this body — chipEligibility reads it from
    // sessionStorage via satisfiesNoTraining — but must still be listed so toggling it
    // recomputes against the now-current value. See the prop's doc comment above.
  }, [enabled, paneCandidates, works, privacyRouting, loggingConfirmed]);

  const emittedRef = useRef<string>("");
  useEffect(() => {
    const serialized = JSON.stringify(activeContext.chips);
    if (serialized === emittedRef.current) return;
    emittedRef.current = serialized;
    onChipsChange(activeContext.chips);
  }, [activeContext, onChipsChange]);

  // A one-line preview of what the next turn will carry, without expanding the strip. No
  // token estimate: that needs the fetched excerpt, which only buildContext has, at send
  // time — the accurate figure appears in the pre-send summary on the sent message.
  const stripLabels =
    activeContext.unlabelled > 0
      ? [...activeContext.labels, `+${activeContext.unlabelled}`]
      : activeContext.labels;
  const stripSummary =
    activeContext.chips.length === 0
      ? t("chat.context.stripEmpty")
      : t("chat.context.stripSummary", { labels: stripLabels.join(", ") });

  return (
    <details
      className="chat-context-strip"
      open={stripOpen}
      onToggle={(event) => setStripOpen(event.currentTarget.open)}
    >
      <summary>{stripSummary}</summary>
      <fieldset className="context-picker">
      <legend>{t("chat.context.title")}</legend>
      {paneCandidates.map((c) => {
        const { eligible, reason } = chipEligibility(c.chip, works, privacyRouting);
        // Hoisted so the "bible" narrowing survives into the onChange closure below.
        const bible = c.chip.kind === "bible" ? c.chip : null;
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
            {bible && eligible && (
              <label className="context-verses">
                {t("chat.context.verses")}
                <input
                  type="text"
                  placeholder={t("chat.context.versesPlaceholder")}
                  // bible.verses already resolves the edit-vs-selected-verse precedence,
                  // including expiring an edit typed for a different chapter.
                  value={bible.verses ?? ""}
                  onChange={(e) =>
                    setVerseEdits((prev) => ({
                      ...prev,
                      [c.key]: { ref: `${bible.osis}:${bible.chapter}`, verses: e.target.value },
                    }))
                  }
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
      {bibleishPanes.map((pane) => (
        <XrefChip
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
    </details>
  );
}

// Reported in a fixed order so the summary is stable turn to turn, and with licence first
// because it is the only reason the reader can act on.
const DROP_REASON_ORDER: DropReason[] = ["licence", "over-cap", "budget", "duplicate", "unavailable"];

const DROP_REASON_KEY: Record<DropReason, string> = {
  licence: "chat.context.dropped.licence",
  "over-cap": "chat.context.dropped.overCap",
  budget: "chat.context.dropped.budget",
  duplicate: "chat.context.dropped.duplicate",
  unavailable: "chat.context.dropped.unavailable",
};

/**
 * The pre-send summary (§5): what is about to be sent, and what was left out and why.
 *
 * Takes the whole `dropped` array rather than a count. `buildContext` computes a reason —
 * and, for a licence block, an actionable detail — for every source it discards, and all of
 * that used to be reduced to a bare number. Worse, a turn where the licence gate blocked
 * *everything* reported "No context selected", which reads as "you did not pick anything"
 * when in fact the reader picked several works and none of them were allowed to leave the
 * browser. §11 requires that to be visible, not a silent omission.
 */
export function summarizeContext(
  sources: readonly Pick<StudySource, "label" | "estimatedTokens">[],
  dropped: readonly DroppedSource[],
  t: (key: string, opts?: Record<string, unknown>) => string,
  droppedTurns = 0,
): string {
  const parts: string[] = [];

  if (sources.length === 0) {
    parts.push(t("chat.context.empty"));
  } else {
    parts.push(
      t("chat.context.summary", {
        labels: sources.map((s) => s.label).join(", "),
        tokens: sources.reduce((sum, s) => sum + s.estimatedTokens, 0),
      }),
    );
  }

  for (const reason of DROP_REASON_ORDER) {
    const items = dropped.filter((d) => d.reason === reason);
    if (items.length === 0) continue;
    parts.push(
      t(DROP_REASON_KEY[reason], {
        count: items.length,
        labels: items.map((d) => d.label).join(", "),
      }),
    );
    // The licence detail names the fix ("turn on privacy routing"), which is the whole
    // point of distinguishing allowed_no_training from prohibited.
    if (reason === "licence") {
      const details = [...new Set(items.map((d) => d.detail).filter((d) => d != null))];
      for (const detail of details) parts.push(t(`chat.licence.${detail}`));
    }
  }

  if (droppedTurns > 0) {
    parts.push(t("chat.context.droppedTurns", { count: droppedTurns }));
  }

  return parts.join(" ");
}
