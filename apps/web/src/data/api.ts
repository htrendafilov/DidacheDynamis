// Typed client for the reader API (mirrors apps/api/app/models.py).

export interface Work {
  id: string;
  type: string;
  language: string;
  title: string;
  abbrev: string;
  direction: string;
  versification: string;
  license: string;
  attribution: string;
  source_url: string | null;
  source_version: string | null;
  ai_context_policy: "allowed" | "prohibited" | "unknown";
}

export interface Book {
  osis: string;
  name: string;
  order: number;
  chapter_count: number;
}

// One Strong's annotation on a verse run (M8.2; named lemma — never strong — so it
// cannot be confused with the DocumentRun.strong bold flag). s/m appear only when
// the source tags morphology for this id.
export interface RunLemma {
  id: string; // normalized Strong's id, e.g. "H1254"
  s?: string; // morphology scheme: 'strongMorph' (OT) | 'robinson' (NT)
  m?: string; // morphology code, e.g. "TH8804"
}

export interface Run {
  t: string;
  wj?: boolean;
  lemma?: RunLemma[]; // word-level lexical data (works with Strong's annotations)
}

export interface Line {
  kind: "p" | "q";
  level: number;
  para_start: boolean;
  runs: Run[];
}

export interface Verse {
  verse: number;
  lines: Line[];
}

export interface Heading {
  before_verse: number;
  kind: string;
  text: string;
}

export interface Passage {
  work_id: string;
  osis: string;
  chapter: number;
  verses: Verse[];
  headings: Heading[];
}

export type SearchSort = "relevance" | "canonical";
export type SearchKind =
  | "bible"
  | "commentary"
  | "dictionary"
  | "book"
  | "strongs";

export interface BibleHit {
  kind: "bible";
  work_id: string;
  title: string;
  snippet: string;
  osis: string;
  chapter: number;
  verse: number;
  ref: string;
}

export interface CommentaryHit {
  kind: "commentary";
  work_id: string;
  title: string;
  snippet: string;
  osis: string;
  chapter: number;
  verse_start: number;
  entry_id: number;
}

export interface DictionaryHit {
  kind: "dictionary";
  work_id: string;
  title: string;
  snippet: string;
  headword: string;
}

export interface BookHit {
  kind: "book";
  work_id: string;
  title: string;
  snippet: string;
  section_id: string;
}

export interface StrongMorphology {
  scheme: "strongMorph" | "robinson";
  code: string;
}

export interface StrongsEntryHit {
  kind: "strongs_entry";
  work_id: string;
  title: string;
  snippet: string;
  strong_id: string;
  language: string | null;
  lemma: string | null;
  transliteration: string | null;
  occurrence_count: number;
  verse_count: number;
}

export interface StrongsOccurrenceHit {
  kind: "strongs_occurrence";
  work_id: string;
  title: string;
  snippet: string;
  strong_id: string;
  osis: string;
  chapter: number;
  verse: number;
  ref: string;
  surfaces: string[];
  occurrence_count: number;
  morphology: StrongMorphology[];
}

export type SearchHit =
  | BibleHit
  | CommentaryHit
  | DictionaryHit
  | BookHit
  | StrongsEntryHit
  | StrongsOccurrenceHit;

export interface SearchGroup {
  type: SearchKind;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  hits: SearchHit[];
}

export interface SearchResponse {
  query: string;
  refine: string | null;
  sort: SearchSort;
  total: number;
  groups: SearchGroup[];
}

export interface Meta {
  content_version: string | null;
  works: number;
}

export interface DocumentBlock {
  kind: "heading" | "paragraph" | "quotation";
  text: string;
  runs?: DocumentRun[];
}

export interface DictionaryDocumentRef {
  work_id: string;
  entry_key: string; // source module key (auditable; future disambiguation lookup)
  headword: string; // resolved display headword the entry API can load
}

export interface DocumentRun {
  t: string;
  emphasis?: boolean;
  strong?: boolean;
  superscript?: boolean;
  ref?: string; // canonical scripture target, e.g. "John.3.16" or "John.3.1-19"
  dictionary_ref?: DictionaryDocumentRef; // mutually exclusive with ref
}

export interface Document {
  blocks: DocumentBlock[];
}

export interface CommentaryEntry {
  verse_start: number | null;
  verse_end: number | null;
  body: Document;
}

export interface CommentaryPassage {
  work_id: string;
  osis: string;
  chapter: number;
  entries: CommentaryEntry[];
}

export interface DictionaryHeadword {
  headword: string;
}

export interface DictionaryEntry {
  work_id: string;
  headword: string;
  body: Document;
}

// One Strong's lexicon entry (M8.2). work_id identifies the lexicon work
// (strongsgreek | strongshebrew) so the client can cite its attribution from /works.
export interface StrongEntry {
  strong_id: string;
  language: string; // 'grc' | 'hbo'
  work_id: string;
  lemma: string;
  transliteration: string | null;
  pronunciation: string | null;
  definition: string;
  see: string[]; // cross-referenced Strong's ids, normalized
}

export interface StrongSource {
  work_id: string;
}

export interface StrongOccurrenceResponse {
  strong_id: string;
  total: number;
  occurrence_total: number;
  offset: number;
  limit: number;
  has_more: boolean;
  available_works: string[];
  hits: StrongsOccurrenceHit[];
}

export interface GeneralBookSection {
  section_id: string;
  title: string;
  level: number;
  body: Document;
  children: GeneralBookSection[];
}

export interface GeneralBook {
  work_id: string;
  sections: GeneralBookSection[];
}

export interface CrossReference {
  target_ref: string;
  target_osis: string;
  target_chapter: number;
  target_verse: number;
  votes: number;
  preview: string | null;
}

export interface CrossReferences {
  osis: string;
  chapter: number;
  verse: number;
  source_work_id: string;
  references: CrossReference[];
}

const BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, statusText: string, path: string) {
    super(`${status} ${statusText} for ${path}`);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init);
  if (!res.ok) throw new ApiError(res.status, res.statusText, path);
  return (await res.json()) as T;
}

export const api = {
  meta: () => get<Meta>("/meta"),
  // Revalidate discovery metadata so a newly deployed source does not keep an old
  // attribution-less /works response from the browser cache.
  works: () => get<Work[]>("/works", { cache: "no-cache" }),
  books: (workId: string) => get<Book[]>(`/works/${workId}/books`),
  passage: (workId: string, osis: string, chapter: number, verses?: string) =>
    get<Passage>(
      `/works/${workId}/passage/${osis}/${chapter}` +
        (verses ? `?verses=${encodeURIComponent(verses)}` : ""),
    ),
  commentary: (workId: string, osis: string, chapter: number, verse?: number) =>
    get<CommentaryPassage>(
      `/commentary/${workId}/${osis}/${chapter}` + (verse ? `?verse=${verse}` : ""),
    ),
  dictionaryHeadwords: (workId: string, prefix: string) =>
    get<DictionaryHeadword[]>(
      `/dictionary/${workId}/entries?prefix=${encodeURIComponent(prefix)}&limit=80`,
    ),
  dictionaryEntry: (workId: string, headword: string) =>
    get<DictionaryEntry>(`/dictionary/${workId}/entry/${encodeURIComponent(headword)}`),
  lexiconEntry: (strongId: string) =>
    get<StrongEntry>(`/lexicon/${encodeURIComponent(strongId)}`),
  lexiconSources: () => get<StrongSource[]>("/lexicon/sources"),
  strongOccurrences: (
    strongId: string,
    opts: {
      verseText?: string;
      works?: string;
      canon?: "ot" | "nt";
      books?: string;
      morphScheme?: "strongMorph" | "robinson";
      morph?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.verseText) params.set("verse_text", opts.verseText);
    if (opts.works) params.set("works", opts.works);
    if (opts.canon) params.set("canon", opts.canon);
    if (opts.books) params.set("books", opts.books);
    if (opts.morphScheme) params.set("morph_scheme", opts.morphScheme);
    if (opts.morph) params.set("morph", opts.morph);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.offset != null) params.set("offset", String(opts.offset));
    const query = params.size ? `?${params.toString()}` : "";
    return get<StrongOccurrenceResponse>(
      `/lexicon/${encodeURIComponent(strongId)}/occurrences${query}`,
    );
  },
  generalBooks: () => get<Work[]>("/books"),
  generalBook: (workId: string) => get<GeneralBook>(`/book/${encodeURIComponent(workId)}`),
  crossReferences: (osis: string, chapter: number, verse: number, previewWork = "web") =>
    get<CrossReferences>(
      `/xref/${osis}/${chapter}/${verse}?preview_work=${encodeURIComponent(previewWork)}`,
    ),
  search: (
    q: string,
    opts: {
      refine?: string;
      verseText?: string;
      morphScheme?: "strongMorph" | "robinson";
      morph?: string;
      types?: string;
      works?: string;
      canon?: "ot" | "nt";
      books?: string;
      languages?: string;
      sort?: SearchSort;
      limit?: number;
      offset?: number;
    } = {},
  ) => {
    const params = new URLSearchParams({ q });
    if (opts.refine) params.set("refine", opts.refine);
    if (opts.verseText) params.set("verse_text", opts.verseText);
    if (opts.morphScheme) params.set("morph_scheme", opts.morphScheme);
    if (opts.morph) params.set("morph", opts.morph);
    if (opts.types) params.set("types", opts.types);
    if (opts.works) params.set("works", opts.works);
    if (opts.canon) params.set("canon", opts.canon);
    if (opts.books) params.set("books", opts.books);
    if (opts.languages) params.set("languages", opts.languages);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.limit != null) params.set("limit", String(opts.limit));
    if (opts.offset != null) params.set("offset", String(opts.offset));
    return get<SearchResponse>(`/search?${params.toString()}`);
  },
};
