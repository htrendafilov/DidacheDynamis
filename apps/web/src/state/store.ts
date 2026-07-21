// App state: panes + reading settings, persisted to localStorage.
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PaneSourceType = "bible" | "commentary" | "dictionary" | "book" | "notes";
export type VerseLayout = "per-line" | "flowing";
export type WordsOfChrist = "off" | "bold" | "red";
export type Theme = "light" | "dark";
export type UiLang = "en" | "bg";
export type BookReadingMode = "paged" | "scroll";

export interface Pane {
  id: string;
  type: PaneSourceType;
  workId: string; // for bible/commentary/dictionary/book
  osis: string; // current book (bible/commentary)
  chapter: number;
  sectionId?: string; // current section for a General Book pane
  bookTocOpen?: boolean;
  bookMode?: BookReadingMode;
}

export interface Settings {
  verseLayout: VerseLayout;
  wordsOfChrist: WordsOfChrist;
  theme: Theme;
  fontScale: number; // 1 = 100%
  uiLang: UiLang;
  sync: boolean; // sync passage across bible panes
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
  requestOpenNote: (noteId: string, osis: string, chapter: number) => void;
  clearNoteTarget: () => void;
}

let seq = 0;
const newId = () => `pane-${Date.now()}-${seq++}`;

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
