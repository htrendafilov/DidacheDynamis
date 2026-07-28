import type { SearchKind, SearchSort } from "../data/api";

export const SEARCH_HISTORY_KEY = "bible-search-v1";
const VERSION = 1;
const MAX_RECENT = 50;

export type SearchSelection = "all" | SearchKind;

export interface SearchState {
  query: string;
  refine: string;
  verseText: string;
  morphScheme: "" | "strongMorph" | "robinson";
  morph: string;
  sort: SearchSort;
  canon: "" | "ot" | "nt";
  works: string[];
  books: string[];
  selected: SearchSelection;
}

export interface SearchHistoryEntry extends SearchState {
  id: string;
  pinned: boolean;
  updatedAt: number;
}

interface StoredHistory {
  version: number;
  entries: SearchHistoryEntry[];
}

function stringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, cap),
    ),
  ];
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 200) : "";
}

function normalizeState(value: Partial<SearchState>): SearchState | null {
  const query = normalizeText(value.query);
  if (!query) return null;
  const sort = value.sort === "canonical" ? "canonical" : "relevance";
  const canon = value.canon === "ot" || value.canon === "nt" ? value.canon : "";
  const selected: SearchSelection =
    value.selected === "bible" ||
    value.selected === "commentary" ||
    value.selected === "dictionary" ||
    value.selected === "book" ||
    value.selected === "strongs"
      ? value.selected
      : "all";
  const morphScheme =
    value.morphScheme === "strongMorph" || value.morphScheme === "robinson"
      ? value.morphScheme
      : "";
  return {
    query,
    refine: normalizeText(value.refine),
    verseText: normalizeText(value.verseText),
    morphScheme,
    morph: morphScheme ? normalizeText(value.morph).slice(0, 40) : "",
    sort,
    canon,
    works: stringList(value.works, 20),
    books: stringList(value.books, 66),
    selected,
  };
}

function normalizeEntry(value: unknown): SearchHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<SearchHistoryEntry>;
  const state = normalizeState(record);
  if (!state) return null;
  return {
    ...state,
    id: typeof record.id === "string" && record.id ? record.id : newId(),
    pinned: record.pinned === true,
    updatedAt:
      typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : 0,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function effectiveKey(state: SearchState): string {
  return JSON.stringify({
    query: state.query.toLocaleLowerCase(),
    refine: state.refine.toLocaleLowerCase(),
    verseText: state.verseText.toLocaleLowerCase(),
    morphScheme: state.morphScheme,
    morph: state.morph.toLocaleUpperCase(),
    sort: state.sort,
    canon: state.canon,
    works: [...state.works].sort(),
    books: [...state.books].sort(),
  });
}

function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function loadSearchHistory(storage?: Storage): SearchHistoryEntry[] {
  try {
    const parsed = JSON.parse((storage ?? browserStorage())?.getItem(SEARCH_HISTORY_KEY) ?? "null") as
      | StoredHistory
      | null;
    if (parsed?.version !== VERSION || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .map(normalizeEntry)
      .filter((entry): entry is SearchHistoryEntry => entry !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveSearchHistory(
  entries: SearchHistoryEntry[],
  storage?: Storage,
): void {
  try {
    (storage ?? browserStorage())?.setItem(
      SEARCH_HISTORY_KEY,
      JSON.stringify({ version: VERSION, entries } satisfies StoredHistory),
    );
  } catch {
    // Search history is a convenience. Private browsing/storage quotas must not break search itself.
  }
}

export function rememberSearch(
  entries: SearchHistoryEntry[],
  value: SearchState,
  updatedAt = Date.now(),
): SearchHistoryEntry[] {
  const state = normalizeState(value);
  if (!state) return entries;
  const key = effectiveKey(state);
  const existing = entries.find((entry) => effectiveKey(entry) === key);
  const next: SearchHistoryEntry = {
    ...state,
    id: existing?.id ?? newId(),
    pinned: existing?.pinned ?? false,
    updatedAt,
  };
  const ordered = [next, ...entries.filter((entry) => entry.id !== existing?.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const pinned = ordered.filter((entry) => entry.pinned);
  const recent = ordered.filter((entry) => !entry.pinned).slice(0, MAX_RECENT);
  return [...pinned, ...recent].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function toggleSearchPinned(
  entries: SearchHistoryEntry[],
  id: string,
): SearchHistoryEntry[] {
  return entries.map((entry) =>
    entry.id === id ? { ...entry, pinned: !entry.pinned } : entry,
  );
}

export function removeSearch(
  entries: SearchHistoryEntry[],
  id: string,
): SearchHistoryEntry[] {
  return entries.filter((entry) => entry.id !== id);
}
