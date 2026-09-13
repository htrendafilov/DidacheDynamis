// M9.4 steps 1, 3 and 4: question -> validated English terms -> search hits -> context
// candidates. Pure retrieval plumbing; the staged UI turn that drives it is a later step,
// and nothing here alters conversation state.
import { api, type SearchHit, type Work } from "../data/api";
import { streamChat, type ChatModel, type ChatUsage } from "./client";
import type { ExtraCandidate } from "./context";
import { ChatError } from "./errors";
import { buildExpansionMessages } from "./prompt";
import { estimateTokens } from "./tokens";
import type { ContextChip } from "./types";

export interface ExpansionResult {
  terms: string[];
  usage?: ChatUsage;
  actualModel?: string; // retain the router's choice for the later turn/history layer
}

function expansionFailed(): ChatError {
  // Never retain the question, raw model output, or provider error in an error message.
  return new ChatError("expansionFailed", "The model did not return usable search terms.");
}

// One term's rule, shared with the confirm panel's hand-typed terms: a term the reader
// adds is no more trusted than one the model produced. Returns the trimmed term or null.
export const MAX_TERMS = 5;
export function validateTerm(entry: string): string | null {
  const term = entry.trim();
  if (term.length < 2 || term.length > 40 || !/^[a-z0-9 '-]+$/i.test(term) || !/[a-z0-9]/i.test(term)) {
    return null;
  }
  return term;
}

export function parseExpansionTerms(output: string): string[] {
  const text = output.trim();
  // Unwrap one complete fence only. Nested fences or surrounding prose still fail JSON.
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  let value: unknown;
  try {
    value = JSON.parse(fence ? fence[1] : text);
  } catch {
    throw expansionFailed();
  }
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_TERMS) throw expansionFailed();

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") throw expansionFailed();
    const term = validateTerm(entry);
    if (term === null) throw expansionFailed();
    // ASCII English terms make lowercase equivalent to casefold. Keep the first spelling.
    // Apostrophes and hyphens deliberately remain: FTS splits them at index/query time.
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      terms.push(term);
    }
  }
  if (terms.length < 2) throw expansionFailed();
  return terms;
}

export async function expandQuestion(
  question: string,
  model: ChatModel,
  privacyRouting: boolean,
  signal: AbortSignal,
  uiLang: "en" | "bg" = "en",
): Promise<ExpansionResult> {
  let output = "";
  try {
    // The user's question travels through the same privacy route as an answer.
    // No source text is sent here, so the ai_context_policy licence gate does not apply.
    const meta = await streamChat(
      {
        providerId: "openrouter",
        model: model.id,
        messages: buildExpansionMessages(question, uiLang),
        maxTokens: 200,
        maxRetries: 0,
        privacyRouting,
        reasoningCaps: model.reasoning,
        signal,
      },
      {
        onDelta: (delta) => { output += delta; },
        onMeta: () => {},
      },
    );
    // streamChat intentionally resolves on cancellation to keep partial answers. Terms
    // have no partial-result semantics: check abort before parsing a truncated response.
    if (signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    return {
      terms: parseExpansionTerms(output),
      usage: meta.usage ?? undefined,
      actualModel: meta.actualModel ?? undefined,
    };
  } catch (err) {
    if (signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
    if (err instanceof ChatError && ["aborted", "auth", "credit", "privacyConstraint"].includes(err.kind)) {
      throw err;
    }
    throw expansionFailed();
  }
}

// ---------------------------------------------------------------------------------------
// Step 3/4 — search fan-out, merge, and hit -> candidate mapping (work order §2, §3)

export interface RankedHit {
  hit: SearchHit;
  term: string; // which confirmed term found it
  rank: number; // its row within its group for that term; 0 is the group's top hit
}

// One search per term, not one search for all terms: fts_query() ANDs its tokens
// (apps/api/app/search_providers.py), so a single call carrying five terms matches only
// documents that hold all five — for a topical question, approximately nothing.
export const MAX_MERGED_HITS = 16;

// Every discriminator is per-work — commentary entry_id numbers from 1 in each work,
// book section_id likewise, and a verse ref is shared by every Bible — so a key without
// work_id would drop a second work's hit as a duplicate of the first. Strong's ids are
// global by construction.
export function hitKey(hit: SearchHit): string {
  switch (hit.kind) {
    case "bible":
    case "strongs_occurrence":
      // An occurrence maps to the same bible chip as a plain hit on that verse (§3).
      return `bible:${hit.work_id}:${hit.osis}:${hit.chapter}:${hit.verse}`;
    case "commentary":
      return `commentary:${hit.work_id}:${hit.entry_id}`;
    case "dictionary":
      return `dictionary:${hit.work_id}:${hit.headword}`;
    case "book":
      return `book:${hit.work_id}:${hit.section_id}`;
    case "strongs_entry":
      return `lexicon:${hit.strong_id}`;
  }
}

// One distinct hit per term per pass. Within each term, visit rank r of every group
// before rank r+1, preserving the API's group order. Taking a whole rank of all groups
// per term would spend the 16-hit cap before the fifth term got a turn.
export function mergeHits(perTerm: { term: string; hits: SearchHit[][] }[]): RankedHit[] {
  const merged: RankedHit[] = [];
  const seen = new Set<string>();
  const queues = perTerm.map(({ term, hits }) => {
    const queue: RankedHit[] = [];
    const deepest = Math.max(0, ...hits.map((g) => g.length));
    for (let rank = 0; rank < deepest; rank++) {
      for (const group of hits) {
        const hit = group[rank];
        if (hit) queue.push({ hit, term, rank });
      }
    }
    return queue.values();
  });
  while (merged.length < MAX_MERGED_HITS) {
    let added = false;
    for (const queue of queues) {
      let next = queue.next();
      // A duplicate consumes neither a result slot nor this term's opportunity to
      // contribute its next distinct hit before the other terms advance again.
      while (!next.done && seen.has(hitKey(next.value.hit))) next = queue.next();
      if (next.done) continue;
      seen.add(hitKey(next.value.hit));
      merged.push(next.value);
      added = true;
      if (merged.length >= MAX_MERGED_HITS) return merged;
    }
    if (!added) break;
  }
  return merged;
}

export async function searchTerms(terms: string[], signal: AbortSignal): Promise<RankedHit[]> {
  if (signal.aborted) throw new ChatError("aborted", "The request was cancelled.");
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  let responses;
  try {
    // Independent GETs against a read-only API, at most five of them. All-or-nothing: a
    // term the reader confirmed and that silently returned nothing would misrepresent
    // what was searched.
    responses = await Promise.all(
      terms.map((term) => api.search(term, { sort: "relevance", signal: controller.signal })),
    );
  } catch (err) {
    // Promise.all rejects early without cancelling its siblings. Stop those requests,
    // but classify the original failure using the caller's signal, not our cleanup abort.
    controller.abort();
    if (signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      throw new ChatError("aborted", "The request was cancelled.");
    }
    throw new ChatError("network", "A network error occurred.");
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  return mergeHits(
    responses.map((r, i) => ({ term: terms[i], hits: r.groups.map((g) => g.hits) })),
  );
}

// The API marks FTS matches as <b>…</b> — those two literals only (search_providers.py
// snippet(...) calls). Nothing else in a snippet is markup, so nothing else is touched:
// a general HTML strip would silently alter source text.
export function stripHighlights(snippet: string): string {
  return snippet.replace(/<\/?b>/g, "");
}

// A hit becomes either a chip (Path A — the existing retrieval fetches the exact unit, so
// scripture is never a snippet) or a pre-built candidate carrying its snippet (Path B —
// commentary and book, whose full units routinely exceed the per-source cap; §3).
export type MappedHit = { chip: ContextChip } | { extra: ExtraCandidate };

export function mapHit(hit: SearchHit, works: readonly Work[]): MappedHit {
  const work = works.find((w) => w.id === hit.work_id);
  const abbrev = work?.abbrev ?? hit.work_id;
  switch (hit.kind) {
    case "bible":
    case "strongs_occurrence":
      return {
        chip: { kind: "bible", workId: hit.work_id, osis: hit.osis, chapter: hit.chapter, verses: String(hit.verse) },
      };
    case "dictionary":
      return { chip: { kind: "dictionary", workId: hit.work_id, headword: hit.headword } };
    case "strongs_entry":
      return { chip: { kind: "lexicon", strongId: hit.strong_id } };
    case "commentary": {
      const excerpt = stripHighlights(hit.snippet);
      const verse = hit.verse_start != null ? `:${hit.verse_start}` : "";
      return {
        extra: {
          source: {
            kind: "commentary",
            workId: hit.work_id,
            label: `${abbrev} — ${hit.osis} ${hit.chapter}${verse}`,
            canonicalTarget: { kind: "commentary", workId: hit.work_id, osis: hit.osis, chapter: hit.chapter },
            language: work?.language ?? "",
            excerpt,
            estimatedTokens: estimateTokens(excerpt, "commentary"),
            searchExcerpt: true,
          },
          requires: [{ workId: hit.work_id, policy: work?.ai_context_policy ?? "unknown" }],
          entryIds: [hit.entry_id],
        },
      };
    }
    case "book": {
      const excerpt = stripHighlights(hit.snippet);
      return {
        extra: {
          source: {
            kind: "book",
            workId: hit.work_id,
            label: `${hit.title} (${abbrev})`,
            canonicalTarget: { kind: "book", workId: hit.work_id, sectionId: hit.section_id },
            language: work?.language ?? "",
            excerpt,
            estimatedTokens: estimateTokens(excerpt, "book"),
            searchExcerpt: true,
          },
          requires: [{ workId: hit.work_id, policy: work?.ai_context_policy ?? "unknown" }],
        },
      };
    }
  }
}

export function hitsToContext(
  hits: readonly RankedHit[],
  works: readonly Work[],
): { chips: ContextChip[]; extras: ExtraCandidate[] } {
  const chips: ContextChip[] = [];
  const extras: ExtraCandidate[] = [];
  for (const { hit } of hits) {
    const mapped = mapHit(hit, works);
    if ("chip" in mapped) chips.push(mapped.chip);
    else extras.push(mapped.extra);
  }
  return { chips, extras };
}
