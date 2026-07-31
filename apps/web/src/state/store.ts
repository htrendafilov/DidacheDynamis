// App state: panes + reading settings, persisted to localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PaneSourceType = "bible" | "commentary" | "dictionary" | "book" | "notes";
export type VerseLayout = "per-line" | "flowing";
export type WordsOfChrist = "off" | "bold" | "red";
export type Theme = "light" | "dark";
export type UiLang = "en" | "bg";
export type BookReadingMode = "paged" | "scroll";
export type StrongsMode = "off" | "on";

export interface Pane {
  id: string;
  type: PaneSourceType;
  workId: string; // for bible/commentary/dictionary/book
  osis: string; // current book (bible/commentary)
  chapter: number;
  sectionId?: string; // current section for a General Book pane
  headword?: string; // current entry for a dictionary pane
  bookTocOpen?: boolean;
  focusVerse?: number; // transient: verse to scroll to and briefly flash (e.g. a search result)
  focusStrong?: string; // transient: Strong's id whose matching spans should flash
  selectedVerse?: number; // clicked verse; drives xrefs, notes, and chat context (M9.3)
}

export interface Settings {
  verseLayout: VerseLayout;
  wordsOfChrist: WordsOfChrist;
  theme: Theme;
  fontScale: number; // 1 = 100%
  uiLang: UiLang;
  sync: boolean; // sync passage across bible panes
  bookMode?: BookReadingMode;
  strongs?: StrongsMode; // Strong's word lookup in Bible panes (off by default, M8.3)
  searchWidth?: number; // width (px) of the docked desktop search workspace
  chatWidth?: number; // width (px) of the docked desktop Assistant workspace (M9.2)
  // Assistant context budget (M9.3c). Absent = the measured defaults in chat/contextBudget.ts;
  // the reader raises these to fit whole commentary chapters, knowingly paying for them.
  chatPerSourceCap?: number;
  chatTotalBudget?: number;
}

interface AppState {
  panes: Pane[];
  settings: Settings;
  noteTargetId: string | null;
  addPane: () => void;
  removePane: (id: string) => void;
  updatePane: (id: string, patch: Partial<Pane>) => void;
  changePaneType: (id: string, type: PaneSourceType) => void;
  setSettings: (patch: Partial<Settings>) => void;
  goToRef: (osis: string, chapter: number, fromPaneId?: string) => void;
  openPassage: (workId: string, osis: string, chapter: number, verse?: number) => void;
  clearFocusVerse: (paneId: string) => void;
  openStrongsOccurrence: (
    workId: string,
    osis: string,
    chapter: number,
    verse: number,
    strongId: string,
    preservePaneId?: string,
  ) => void;
  clearStrongFocus: (paneId: string) => void;
  openCommentary: (workId: string, osis: string, chapter: number) => void;
  openDictionary: (workId: string, headword: string) => void;
  openBookSection: (workId: string, sectionId: string) => void;
  requestOpenNote: (noteId: string, osis: string, chapter: number) => void;
  clearNoteTarget: () => void;
}

let seq = 0;
const newId = () => `pane-${Date.now()}-${seq++}`;

// Open a search result: reuse the first pane of the target type, else add one (if room), else
// convert the last pane. `patch` carries the pane type + the fields that locate the result.
function placePane(
  panes: Pane[],
  patch: Partial<Pane> & { type: PaneSourceType; workId: string },
  preservePaneId?: string,
): Pane[] {
  const existing = panes.find((p) => p.type === patch.type);
  if (existing) return panes.map((p) => (p.id === existing.id ? { ...p, ...patch } : p));
  if (panes.length < 3) {
    const base: Pane = { id: newId(), osis: "John", chapter: 3, ...patch };
    return [...panes, base];
  }
  const replacement =
    [...panes].reverse().find((pane) => pane.id !== preservePaneId) ??
    panes[panes.length - 1];
  return panes.map((p) => (p.id === replacement.id ? { ...p, ...patch } : p));
}

const defaultPane = (): Pane => ({
  id: newId(),
  type: "bible",
  workId: "web",
  osis: "John",
  chapter: 3,
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      panes: [defaultPane()],
      settings: {
        verseLayout: "per-line",
        wordsOfChrist: "red",
        theme: "light",
        fontScale: 1,
        uiLang: "bg",
        sync: true,
        bookMode: "paged",
        strongs: "off",
      },
      noteTargetId: null,
      addPane: () =>
        set((s) => (s.panes.length >= 3 ? s : { panes: [...s.panes, defaultPane()] })),
      removePane: (id) =>
        set((s) => (s.panes.length <= 1 ? s : { panes: s.panes.filter((p) => p.id !== id) })),
      updatePane: (id, patch) =>
        set((s) => ({ panes: s.panes.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      changePaneType: (id, type) => {
        const workId =
          type === "bible"
            ? "web"
            : type === "commentary"
              ? "mhc"
              : type === "dictionary"
                ? "easton"
                : type === "book"
                  ? "baptist1689"
                  : "";
        set((s) => ({
          panes: s.panes.map((p) =>
            p.id === id ? { ...p, type, workId, sectionId: undefined } : p,
          ),
        }));
      },
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      goToRef: (osis, chapter, fromPaneId) => {
        const { settings, panes } = get();
        set({
          panes: panes.map((p) => {
            if (p.type !== "bible" && p.type !== "commentary") return p;
            if (settings.sync || p.id === fromPaneId) return { ...p, osis, chapter };
            return p;
          }),
        });
      },
      openPassage: (workId, osis, chapter, verse) =>
        set((s) => ({
          panes: placePane(s.panes, { type: "bible", workId, osis, chapter, focusVerse: verse }),
        })),
      clearFocusVerse: (paneId) =>
        set((s) => ({
          panes: s.panes.map((p) => (p.id === paneId ? { ...p, focusVerse: undefined } : p)),
        })),
      openStrongsOccurrence: (
        workId,
        osis,
        chapter,
        verse,
        strongId,
        preservePaneId,
      ) =>
        set((s) => ({
          panes: placePane(
            s.panes,
            {
              type: "bible",
              workId,
              osis,
              chapter,
              focusVerse: verse,
              focusStrong: strongId,
            },
            preservePaneId,
          ),
          settings: { ...s.settings, strongs: "on" },
        })),
      clearStrongFocus: (paneId) =>
        set((s) => ({
          panes: s.panes.map((p) =>
            p.id === paneId ? { ...p, focusStrong: undefined } : p,
          ),
        })),
      openCommentary: (workId, osis, chapter) =>
        set((s) => ({ panes: placePane(s.panes, { type: "commentary", workId, osis, chapter }) })),
      openDictionary: (workId, headword) =>
        set((s) => ({ panes: placePane(s.panes, { type: "dictionary", workId, headword }) })),
      openBookSection: (workId, sectionId) =>
        set((s) => ({ panes: placePane(s.panes, { type: "book", workId, sectionId }) })),
      requestOpenNote: (noteId, osis, chapter) =>
        set((state) => {
          const hasNotesPane = state.panes.some((pane) => pane.type === "notes");
          const panes =
            !hasNotesPane && state.panes.length < 3
              ? [
                  ...state.panes,
                  {
                    id: newId(),
                    type: "notes" as const,
                    workId: "",
                    osis,
                    chapter,
                  },
                ]
              : state.panes;
          return { panes, noteTargetId: noteId };
        }),
      clearNoteTarget: () => set({ noteTargetId: null }),
    }),
    {
      name: "bible-app",
      partialize: (state) => ({ panes: state.panes, settings: state.settings }),
    },
  ),
);
