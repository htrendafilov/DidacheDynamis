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
}

export interface Book {
  osis: string;
  name: string;
  order: number;
  chapter_count: number;
}

export interface Run {
  t: string;
  wj?: boolean;
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

export interface SearchHit {
  work_id: string;
  ref: string;
  osis: string;
  chapter: number;
  verse: number;
  snippet: string;
}

export interface SearchResult {
  query: string;
  limit: number;
  offset: number;
  hits: SearchHit[];
}

export interface Meta {
  content_version: string | null;
  works: number;
}

export interface DocumentBlock {
  kind: "heading" | "paragraph";
  text: string;
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return (await res.json()) as T;
}

export const api = {
  meta: () => get<Meta>("/meta"),
  works: () => get<Work[]>("/works"),
  books: (workId: string) => get<Book[]>(`/works/${workId}/books`),
  passage: (workId: string, osis: string, chapter: number) =>
    get<Passage>(`/works/${workId}/passage/${osis}/${chapter}`),
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
  crossReferences: (osis: string, chapter: number, verse: number, previewWork = "web") =>
    get<CrossReferences>(
      `/xref/${osis}/${chapter}/${verse}?preview_work=${encodeURIComponent(previewWork)}`,
    ),
  search: (q: string, works?: string) =>
    get<SearchResult>(
      `/search?q=${encodeURIComponent(q)}` + (works ? `&works=${encodeURIComponent(works)}` : ""),
    ),
};
