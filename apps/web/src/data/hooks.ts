import { useEffect, useState } from "react";

import { api, type Book, type Passage, type Work } from "./api";

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
