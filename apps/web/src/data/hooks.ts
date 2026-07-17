import { useEffect, useState } from "react";

import {
  api,
  type Book,
  type CommentaryPassage,
  type CrossReferences,
  type DictionaryEntry,
  type DictionaryHeadword,
  type Passage,
  type Work,
} from "./api";

const booksCache = new Map<string, Book[]>();

export function useWorks(): Work[] | null {
  const [works, setWorks] = useState<Work[] | null>(null);
  useEffect(() => {
    api
      .works()
      .then(setWorks)
      .catch(() => setWorks([]));
  }, []);
  return works;
}

export function useBooks(workId: string): Book[] | null {
  const [books, setBooks] = useState<Book[] | null>(booksCache.get(workId) ?? null);
  useEffect(() => {
    const cached = booksCache.get(workId);
    if (cached) {
      setBooks(cached);
      return;
    }
    let alive = true;
    api
      .books(workId)
      .then((b) => {
        booksCache.set(workId, b);
        if (alive) setBooks(b);
      })
      .catch(() => alive && setBooks([]));
    return () => {
      alive = false;
    };
  }, [workId]);
  return books;
}

export interface PassageState {
  loading: boolean;
  error: boolean;
  data: Passage | null;
}

export function usePassage(workId: string, osis: string, chapter: number): PassageState {
  const [state, setState] = useState<PassageState>({ loading: true, error: false, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, data: null });
    api
      .passage(workId, osis, chapter)
      .then((data) => alive && setState({ loading: false, error: false, data }))
      .catch(() => alive && setState({ loading: false, error: true, data: null }));
    return () => {
      alive = false;
    };
  }, [workId, osis, chapter]);
  return state;
}

export function useCommentary(workId: string, osis: string, chapter: number) {
  const [state, setState] = useState<{
    loading: boolean;
    error: boolean;
    data: CommentaryPassage | null;
  }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, data: null });
    api
      .commentary(workId, osis, chapter)
      .then((data) => alive && setState({ loading: false, error: false, data }))
      .catch(() => alive && setState({ loading: false, error: true, data: null }));
    return () => {
      alive = false;
    };
  }, [workId, osis, chapter]);
  return state;
}

export function useDictionaryHeadwords(workId: string, prefix: string): DictionaryHeadword[] | null {
  const [words, setWords] = useState<DictionaryHeadword[] | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .dictionaryHeadwords(workId, prefix)
      .then((data) => alive && setWords(data))
      .catch(() => alive && setWords([]));
    return () => {
      alive = false;
    };
  }, [workId, prefix]);
  return words;
}

export function useDictionaryEntry(workId: string, headword: string | null): DictionaryEntry | null {
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  useEffect(() => {
    if (!headword) {
      setEntry(null);
      return;
    }
    let alive = true;
    setEntry(null);
    api
      .dictionaryEntry(workId, headword)
      .then((data) => alive && setEntry(data))
      .catch(() => alive && setEntry(null));
    return () => {
      alive = false;
    };
  }, [workId, headword]);
  return entry;
}

export function useCrossReferences(
  osis: string,
  chapter: number,
  verse: number | null,
  previewWork: string,
): CrossReferences | null {
  const [data, setData] = useState<CrossReferences | null>(null);
  useEffect(() => {
    if (verse === null) {
      setData(null);
      return;
    }
    let alive = true;
    setData(null);
    api
      .crossReferences(osis, chapter, verse, previewWork)
      .then((result) => alive && setData(result))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [osis, chapter, verse, previewWork]);
  return data;
}
