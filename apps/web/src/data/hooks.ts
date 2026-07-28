import { useEffect, useState } from "react";

import {
  ApiError,
  api,
  type Book,
  type CommentaryPassage,
  type CrossReferences,
  type DictionaryEntry,
  type DictionaryHeadword,
  type GeneralBook,
  type Passage,
  type StrongEntry,
  type Work,
} from "./api";

const booksCache = new Map<string, Book[]>();
let worksCache: Work[] | undefined;
let worksRequest: Promise<Work[]> | null = null;

function loadWorks(): Promise<Work[]> {
  if (worksCache !== undefined) return Promise.resolve(worksCache);
  if (worksRequest === null) {
    worksRequest = api
      .works()
      .then((works) => {
        worksCache = works;
        return works;
      })
      .finally(() => {
        worksRequest = null;
      });
  }
  return worksRequest;
}

/** Test-only: clear shared work discovery state between specs. */
export function clearWorksCache(): void {
  worksCache = undefined;
  worksRequest = null;
}

export function useWorks(): Work[] | null {
  const [works, setWorks] = useState<Work[] | null>(() => worksCache ?? null);
  useEffect(() => {
    if (worksCache !== undefined) {
      setWorks(worksCache);
      return;
    }
    let alive = true;
    loadWorks()
      .then((loaded) => alive && setWorks(loaded))
      .catch(() => alive && setWorks([]));
    return () => {
      alive = false;
    };
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

export function useDictionaryEntry(workId: string, headword: string | null) {
  const [state, setState] = useState<{
    loading: boolean;
    error: boolean;
    data: DictionaryEntry | null;
  }>({ loading: false, error: false, data: null });
  useEffect(() => {
    if (!headword) {
      setState({ loading: false, error: false, data: null });
      return;
    }
    let alive = true;
    setState({ loading: true, error: false, data: null });
    api
      .dictionaryEntry(workId, headword)
      .then((data) => alive && setState({ loading: false, error: false, data }))
      .catch(() => alive && setState({ loading: false, error: true, data: null }));
    return () => {
      alive = false;
    };
  }, [workId, headword]);
  return state;
}

export function useGeneralBook(workId: string) {
  const [state, setState] = useState<{
    loading: boolean;
    error: boolean;
    data: GeneralBook | null;
  }>({ loading: true, error: false, data: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, error: false, data: null });
    api
      .generalBook(workId)
      .then((data) => alive && setState({ loading: false, error: false, data }))
      .catch(() => alive && setState({ loading: false, error: true, data: null }));
    return () => {
      alive = false;
    };
  }, [workId]);
  return state;
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

// Strong's lexicon lookups (M8.3). Surface words repeat constantly ('the' -> G3588), so
// results are deduplicated and cached for the session; a missing entry (the module key
// holes, e.g. G3778) caches as null rather than re-failing on every hover.
const strongEntryCache = new Map<string, Promise<StrongEntry | null>>();

export function strongEntry(strongId: string): Promise<StrongEntry | null> {
  let cached = strongEntryCache.get(strongId);
  if (!cached) {
    cached = api.lexiconEntry(strongId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      // A transient/network/server failure must be retryable, not poisoned into a
      // session-long "missing entry" cache result.
      strongEntryCache.delete(strongId);
      throw error;
    });
    strongEntryCache.set(strongId, cached);
  }
  return cached;
}

/** Test-only: clear the session lexicon cache between specs. */
export function clearStrongEntryCache(): void {
  strongEntryCache.clear();
}

export function useStrongEntry(strongId: string | null) {
  const [state, setState] = useState<{
    loading: boolean;
    notFound: boolean;
    error: boolean;
    data: StrongEntry | null;
  }>({ loading: false, notFound: false, error: false, data: null });
  useEffect(() => {
    if (!strongId) {
      setState({ loading: false, notFound: false, error: false, data: null });
      return;
    }
    let alive = true;
    setState({ loading: true, notFound: false, error: false, data: null });
    strongEntry(strongId)
      .then((data) => {
        if (!alive) return;
        setState({
          loading: false,
          notFound: data === null,
          error: false,
          data,
        });
      })
      .catch(() => {
        if (!alive) return;
        setState({ loading: false, notFound: false, error: true, data: null });
      });
    return () => {
      alive = false;
    };
  }, [strongId]);
  return state;
}
