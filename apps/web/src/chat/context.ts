// Context builder (M9.3 step 3, §4 + §11). Turns the picker's chips into budgeted,
// licence-gated StudySources by calling the existing /api/v1 routes only — no new
// endpoints, no aliases.
//
// Deviates from the plan's illustrative buildContext(chips, signal) signature by two
// required parameters: `works` (for the ai_context_policy lookup the licence gate needs
// — that field lives on Work, not on any CIR response) and `privacyRouting` (ephemeral
// React state the licence gate consults via satisfiesNoTraining). Both must come from the
// caller; there is no way for a plain async function to read either on its own.
import { api, type CommentaryEntry, type GeneralBookSection, type Work } from "../data/api";
import { strongEntry } from "../data/hooks";
import { db } from "../data/notes";
import { normalizeStrongId, strongLexiconWorkId } from "../data/strongs";
import { satisfiesNoTraining } from "./credentials";
import {
  crossReferencesToText,
  documentToText,
  passageToText,
  strongEntryToText,
} from "./normalize";
import { estimateTokens } from "./tokens";
import type { CanonicalTarget, ContextChip, DroppedSource, SourceKind, StudySource } from "./types";

const PER_SOURCE_CAP_TOKENS = 2000;
const TOTAL_BUDGET_TOKENS = 8000;
const MAX_SOURCES = 12;

// Fixed relevance order (§4): selected verse range -> commentary on that range ->
// Strong's entries -> cross-references -> dictionary entries -> book section -> notes.
const KIND_PRIORITY: Record<SourceKind, number> = {
  bible: 0,
  commentary: 1,
  lexicon: 2,
  xref: 3,
  dictionary: 4,
  book: 5,
  note: 6,
};

function workById(works: Work[], workId: string): Work | undefined {
  return works.find((w) => w.id === workId);
}

function policyEligible(policy: Work["ai_context_policy"], privacyRouting: boolean): boolean {
  switch (policy) {
    case "allowed":
      return true;
    case "allowed_no_training":
      return satisfiesNoTraining(privacyRouting);
    case "prohibited":
    case "unknown":
      return false;
  }
}

function licenceDetail(policy: Work["ai_context_policy"], privacyRouting: boolean): string {
  if (policy === "allowed_no_training") {
    return privacyRouting
      ? "confirm OpenRouter logging is disabled for this session"
      : "turn on privacy routing";
  }
  return policy === "unknown" ? "this work's AI-use licence is unrecorded" : "blocked by this work's licence";
}

// Strips tags for a note excerpt; notes store sanitized HTML, and normalize.ts's "never
// emit HTML" rule applies here too, even though notes are not CIR and so are not one of
// normalize.ts's four functions.
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function findSection(sections: GeneralBookSection[], sectionId: string): GeneralBookSection | null {
  for (const section of sections) {
    if (section.section_id === sectionId) return section;
    const found = findSection(section.children, sectionId);
    if (found) return found;
  }
  return null;
}

function selectCommentaryEntries(entries: CommentaryEntry[], verse?: number): CommentaryEntry[] {
  if (verse == null) return entries;
  return entries.filter((e) => {
    const start = e.verse_start ?? -Infinity;
    const end = e.verse_end ?? e.verse_start ?? Infinity;
    return verse >= start && verse <= end;
  });
}

// One licence policy this candidate's text depends on. Usually one work; an xref source
// depends on two (the reference database and whichever work supplied preview text).
interface RequiredPolicy {
  workId: string;
  policy: Work["ai_context_policy"];
}

interface Candidate {
  source: Omit<StudySource, "id">;
  requires: RequiredPolicy[];
}

function fallbackLabel(chip: ContextChip): string {
  switch (chip.kind) {
    case "bible":
      return `${chip.osis} ${chip.chapter}${chip.verses ? `:${chip.verses}` : ""}`;
    case "commentary":
      return `${chip.osis} ${chip.chapter}${chip.verse ? `:${chip.verse}` : ""} commentary`;
    case "dictionary":
      return chip.headword;
    case "lexicon":
      return `Strong's ${chip.strongId}`;
    case "xref":
      return `${chip.osis} ${chip.chapter}:${chip.verse} cross-references`;
    case "book":
      return chip.sectionId;
    case "note":
      return "note";
  }
}

async function buildCandidate(
  chip: ContextChip,
  works: Work[],
  contentVersion: string,
  signal: AbortSignal,
): Promise<Candidate | null> {
  switch (chip.kind) {
    case "bible": {
      const work = workById(works, chip.workId);
      const passage = await api.passage(chip.workId, chip.osis, chip.chapter, chip.verses, signal);
      const excerpt = passageToText(passage, chip.verses);
      if (!excerpt) return null;
      const canonicalTarget: CanonicalTarget = {
        kind: "bible",
        workId: chip.workId,
        osis: chip.osis,
        chapter: chip.chapter,
      };
      return {
        source: {
          kind: "bible",
          workId: chip.workId,
          label: `${chip.osis} ${chip.chapter}${chip.verses ? `:${chip.verses}` : ""} (${work?.abbrev ?? chip.workId})`,
          canonicalTarget,
          language: work?.language ?? "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "bible"),
        },
        requires: [{ workId: chip.workId, policy: work?.ai_context_policy ?? "unknown" }],
      };
    }
    case "commentary": {
      const work = workById(works, chip.workId);
      const passage = await api.commentary(chip.workId, chip.osis, chip.chapter, chip.verse, signal);
      const entries = selectCommentaryEntries(passage.entries, chip.verse);
      if (entries.length === 0) return null;
      const excerpt = entries
        .map((e) => documentToText(e.body))
        .filter(Boolean)
        .join("\n\n");
      if (!excerpt) return null;
      const canonicalTarget: CanonicalTarget = {
        kind: "commentary",
        workId: chip.workId,
        osis: chip.osis,
        chapter: chip.chapter,
      };
      return {
        source: {
          kind: "commentary",
          workId: chip.workId,
          label: `${work?.abbrev ?? chip.workId} — ${chip.osis} ${chip.chapter}${chip.verse ? `:${chip.verse}` : ""}`,
          canonicalTarget,
          language: work?.language ?? "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "commentary"),
        },
        requires: [{ workId: chip.workId, policy: work?.ai_context_policy ?? "unknown" }],
      };
    }
    case "dictionary": {
      const work = workById(works, chip.workId);
      const entry = await api.dictionaryEntry(chip.workId, chip.headword, signal);
      const excerpt = documentToText(entry.body);
      if (!excerpt) return null;
      const canonicalTarget: CanonicalTarget = {
        kind: "dictionary",
        workId: chip.workId,
        headword: entry.headword,
      };
      return {
        source: {
          kind: "dictionary",
          workId: chip.workId,
          label: `${entry.headword} (${work?.abbrev ?? chip.workId})`,
          canonicalTarget,
          language: work?.language ?? "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "dictionary"),
        },
        requires: [{ workId: chip.workId, policy: work?.ai_context_policy ?? "unknown" }],
      };
    }
    case "lexicon": {
      const normalized = normalizeStrongId(chip.strongId);
      if (!normalized) return null;
      const entry = await strongEntry(normalized);
      if (!entry) return null;
      const workId = strongLexiconWorkId(normalized);
      const work = workById(works, workId);
      const excerpt = strongEntryToText(entry);
      const canonicalTarget: CanonicalTarget = { kind: "lexicon", strongId: entry.strong_id };
      return {
        source: {
          kind: "lexicon",
          workId,
          label: `Strong's ${entry.strong_id} (${entry.lemma})`,
          canonicalTarget,
          language: entry.language,
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "lexicon"),
        },
        requires: [{ workId, policy: work?.ai_context_policy ?? "unknown" }],
      };
    }
    case "xref": {
      const xrefs = await api.crossReferences(chip.osis, chip.chapter, chip.verse, chip.previewWork, signal);
      if (xrefs.references.length === 0) return null;
      const excerpt = crossReferencesToText(xrefs);
      const tskWork = workById(works, xrefs.source_work_id);
      const hasPreview = xrefs.references.some((r) => r.preview !== null);
      const previewWork = hasPreview ? workById(works, chip.previewWork) : undefined;
      const requires: RequiredPolicy[] = [
        { workId: xrefs.source_work_id, policy: tskWork?.ai_context_policy ?? "unknown" },
      ];
      if (hasPreview) requires.push({ workId: chip.previewWork, policy: previewWork?.ai_context_policy ?? "unknown" });
      const canonicalTarget: CanonicalTarget = {
        kind: "xref",
        workId: chip.previewWork,
        osis: chip.osis,
        chapter: chip.chapter,
        verse: chip.verse,
      };
      const count = xrefs.references.length;
      return {
        source: {
          kind: "xref",
          workId: chip.previewWork,
          label: `${count} cross-reference${count === 1 ? "" : "s"} (${chip.osis} ${chip.chapter}:${chip.verse})`,
          canonicalTarget,
          language: previewWork?.language ?? tskWork?.language ?? "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "xref"),
        },
        requires,
      };
    }
    case "book": {
      const work = workById(works, chip.workId);
      const generalBook = await api.generalBook(chip.workId, signal);
      const section = findSection(generalBook.sections, chip.sectionId);
      if (!section) return null;
      const excerpt = documentToText(section.body);
      if (!excerpt) return null;
      const canonicalTarget: CanonicalTarget = {
        kind: "book",
        workId: chip.workId,
        sectionId: chip.sectionId,
      };
      return {
        source: {
          kind: "book",
          workId: chip.workId,
          label: `${section.title} (${work?.abbrev ?? chip.workId})`,
          canonicalTarget,
          language: work?.language ?? "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "book"),
        },
        requires: [{ workId: chip.workId, policy: work?.ai_context_policy ?? "unknown" }],
      };
    }
    case "note": {
      const note = await db.notes.get(chip.noteId);
      if (!note || note.deletedAt) return null;
      const excerpt = htmlToText(note.contentHtml);
      if (!excerpt) return null;
      const canonicalTarget: CanonicalTarget = {
        kind: "note",
        noteId: note.id,
        osis: note.osis ?? "",
        chapter: note.chapter ?? 1,
      };
      return {
        source: {
          kind: "note",
          label: note.title || "note",
          canonicalTarget,
          // Notes carry no language field; a personal note may mix languages freely.
          language: "",
          excerpt,
          contentVersion,
          estimatedTokens: estimateTokens(excerpt, "note"),
        },
        // Personal data, never third-party licensed text: no work policy applies. The
        // personal-data warning itself is ContextPicker's concern (§5), not a gate here.
        requires: [],
      };
    }
  }
}

function normalizedExcerpt(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isDuplicate(a: Omit<StudySource, "id">, b: Omit<StudySource, "id">): boolean {
  if (normalizedExcerpt(a.excerpt) === normalizedExcerpt(b.excerpt)) return true;
  return (
    a.kind === b.kind &&
    a.workId != null &&
    a.workId === b.workId &&
    JSON.stringify(a.canonicalTarget) === JSON.stringify(b.canonicalTarget)
  );
}

export async function buildContext(
  chips: ContextChip[],
  works: Work[],
  privacyRouting: boolean,
  signal: AbortSignal,
): Promise<{ sources: StudySource[]; dropped: DroppedSource[] }> {
  const meta = await api.meta();
  const contentVersion = meta.content_version ?? "unknown";
  const dropped: DroppedSource[] = [];

  // 1. Retrieve every candidate.
  const candidates: Candidate[] = [];
  for (const chip of chips) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      const built = await buildCandidate(chip, works, contentVersion, signal);
      if (built) candidates.push(built);
      else dropped.push({ label: fallbackLabel(chip), kind: chip.kind, reason: "unavailable" });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      dropped.push({ label: fallbackLabel(chip), kind: chip.kind, reason: "unavailable" });
    }
  }

  // 2. Licence gate, before anything else that costs budget.
  const licensed: Candidate[] = [];
  for (const c of candidates) {
    const blocking = c.requires.find((r) => !policyEligible(r.policy, privacyRouting));
    if (blocking) {
      dropped.push({
        label: c.source.label,
        kind: c.source.kind,
        reason: "licence",
        detail: licenceDetail(blocking.policy, privacyRouting),
      });
    } else {
      licensed.push(c);
    }
  }

  // 3. Per-source cap: drop whole, never truncate.
  const capped: Candidate[] = [];
  for (const c of licensed) {
    if (c.source.estimatedTokens > PER_SOURCE_CAP_TOKENS) {
      dropped.push({ label: c.source.label, kind: c.source.kind, reason: "over-cap" });
    } else {
      capped.push(c);
    }
  }

  // 4. Keep in relevance order until the total/count budget is spent.
  const ranked = capped
    .map((c, index) => ({ c, index }))
    .sort((a, b) => KIND_PRIORITY[a.c.source.kind] - KIND_PRIORITY[b.c.source.kind] || a.index - b.index)
    .map(({ c }) => c);
  const kept: Candidate[] = [];
  let total = 0;
  for (const c of ranked) {
    if (kept.length >= MAX_SOURCES || total + c.source.estimatedTokens > TOTAL_BUDGET_TOKENS) {
      dropped.push({ label: c.source.label, kind: c.source.kind, reason: "budget" });
      continue;
    }
    kept.push(c);
    total += c.source.estimatedTokens;
  }

  // 5. Deduplicate overlapping excerpts.
  const deduped: Candidate[] = [];
  for (const c of kept) {
    if (deduped.some((d) => isDuplicate(d.source, c.source))) {
      dropped.push({ label: c.source.label, kind: c.source.kind, reason: "duplicate" });
    } else {
      deduped.push(c);
    }
  }

  // 6. Assign S1..Sn only after all dropping, so ids are contiguous.
  const sources: StudySource[] = deduped.map((c, i) => ({
    ...c.source,
    id: `S${i + 1}` as `S${number}`,
  }));

  return { sources, dropped };
}
