import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLiveQuery } from "dexie-react-hooks";

import { SourceSelector } from "../components/SourceSelector";
import {
  createTopic,
  db,
  deleteNote,
  ensurePassageNote,
  exportNotes,
  getNote,
  importNotes,
  listNotes,
  MAX_NOTE_TITLE_LENGTH,
  restoreDeletedNote,
  type Note,
  updateNote,
} from "../data/notes";
import { bookName } from "../i18n/bookNames";
import { NoteImageError } from "../notes/images";
import { printNotesToPdf } from "../notes/print";
import { NoteSaveQueue, type SaveStatus } from "../notes/saveQueue";
import { useStore, type Pane } from "../state/store";
import { useDropboxSync } from "../sync/dropboxState";

// The rich-text editor pulls in TipTap; load it only when a note is actually opened
// so it stays out of the initial bundle for readers who never use notes.
const RichTextEditor = lazy(() =>
  import("../components/RichTextEditor").then((module) => ({ default: module.RichTextEditor })),
);

const EMPTY_NOTES: Note[] = [];

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function NotesPane({ pane }: { pane: Pane }) {
  const { t, i18n } = useTranslation();
  const panes = useStore((state) => state.panes);
  const goToRef = useStore((state) => state.goToRef);
  const changePaneType = useStore((state) => state.changePaneType);
  const noteTargetId = useStore((state) => state.noteTargetId);
  const clearNoteTarget = useStore((state) => state.clearNoteTarget);
  const dropboxConnected = useDropboxSync((state) => state.connected);

  const queriedNotes = useLiveQuery(
    async () => (await db.notes.orderBy("updatedAt").reverse().toArray()).filter((n) => !n.deletedAt),
    [],
  );
  const notes = queriedNotes ?? EMPTY_NOTES;
  const [tab, setTab] = useState<"topic" | "passage">("topic");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<unknown>();
  const [lastDeleted, setLastDeleted] = useState<Note | null>(null);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);
  const topicTabRef = useRef<HTMLButtonElement>(null);
  const passageTabRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const saveQueueRef = useRef<NoteSaveQueue>();
  if (!saveQueueRef.current) {
    saveQueueRef.current = new NoteSaveQueue(
      (id, patch) => updateNote(id, patch),
      (status, error) => {
        if (!mounted.current) return;
        setSaveStatus(status);
        setSaveError(error);
      },
    );
  }
  const saveQueue = saveQueueRef.current;

  const biblePane = panes.find((candidate) => candidate.type === "bible");
  const refLabel = (
    osis: string,
    chapter: number,
    verseStart?: number,
    verseEnd?: number,
  ) => {
    const verse = verseStart
      ? `:${verseStart}${verseEnd && verseEnd !== verseStart ? `–${verseEnd}` : ""}`
      : "";
    return `${bookName(osis, i18n.language, osis)} ${chapter}${verse}`;
  };
  const noteLabel = (note: Note) =>
    note.kind === "passage" && note.osis && note.chapter
      ? refLabel(note.osis, note.chapter, note.verseStart, note.verseEnd)
      : note.title || t("notes.untitled");

  const topics = notes.filter((note) => note.kind === "topic");
  const passages = notes.filter((note) => note.kind === "passage");
  const active = notes.find((note) => note.id === activeId) ?? null;
  const list = tab === "topic" ? topics : passages;

  useEffect(() => {
    setTitleDraft(active?.title ?? "");
  }, [active?.title, activeId]);

  useEffect(() => {
    if (!noteTargetId) return;
    const target = notes.find((note) => note.id === noteTargetId);
    if (!target) return;
    setTab(target.kind);
    setActiveId(target.id);
    clearNoteTarget();
  }, [clearNoteTarget, noteTargetId, notes]);

  useEffect(() => {
    mounted.current = true;
    const flush = () => void saveQueue.flushAll();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [saveQueue]);

  useEffect(() => {
    if (!navigator.storage?.estimate) return;
    void navigator.storage.estimate().then((estimate) => {
      if (mounted.current) setStorageBytes(estimate.usage ?? null);
    });
  }, [notes]);

  const flushOrWarn = async (): Promise<boolean> => {
    const saved = await saveQueue.flushAll();
    if (!saved) window.alert(t("notes.saveFailed"));
    return saved;
  };

  const selectNote = async (note: Note) => {
    if (!(await flushOrWarn())) return;
    setActiveId(note.id);
    setTitleDraft(note.title);
    if (note.kind === "passage" && note.osis && note.chapter) {
      goToRef(note.osis, note.chapter, biblePane?.id);
    }
  };

  const changeTab = async (next: "topic" | "passage") => {
    if (next === tab || !(await flushOrWarn())) return;
    setTab(next);
    setActiveId(null);
  };

  const onContentChange = (html: string) => {
    if (activeId) saveQueue.schedule(activeId, { contentHtml: html });
  };

  const onTitleChange = (value: string) => {
    setTitleDraft(value);
    if (activeId) saveQueue.schedule(activeId, { title: value });
  };

  const newTopic = async () => {
    if (!(await flushOrWarn())) return;
    const title = window.prompt(t("notes.newTopicPrompt") ?? "Topic");
    if (!title?.trim()) return;
    const id = await createTopic(title);
    setTab("topic");
    setActiveId(id);
    setTitleDraft(title.trim());
  };

  const noteOnPassage = async () => {
    if (!biblePane || !(await flushOrWarn())) return;
    const id = await ensurePassageNote(
      biblePane.osis,
      biblePane.chapter,
      refLabel(biblePane.osis, biblePane.chapter),
    );
    setTab("passage");
    setActiveId(id);
  };

  const removeActive = async () => {
    if (!active || !window.confirm(t("notes.deleteConfirm"))) return;
    if (!(await flushOrWarn())) return;
    saveQueue.cancel(active.id);
    await deleteNote(active.id);
    setLastDeleted(active);
    setActiveId(null);
  };

  const undoDelete = async () => {
    if (!lastDeleted) return;
    await restoreDeletedNote(lastDeleted.id);
    setTab(lastDeleted.kind);
    setActiveId(lastDeleted.id);
    setLastDeleted(null);
  };

  const restore = async (file: File) => {
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Backup is too large");
      if (!(await flushOrWarn())) return;
      const result = await importNotes(JSON.parse(await file.text()));
      window.alert(
        t("notes.restored", {
          imported: result.imported,
          unchanged: result.unchanged,
          conflicts: result.conflicts,
        }),
      );
    } catch {
      window.alert(t("notes.restoreFailed"));
    }
  };

  const printOne = async () => {
    if (!active || !(await flushOrWarn())) return;
    const fresh = await getNote(active.id);
    if (fresh && !fresh.deletedAt) printNotesToPdf([fresh], noteLabel(fresh), refLabel);
  };

  const printAll = async () => {
    if (!(await flushOrWarn())) return;
    printNotesToPdf(
      await listNotes(),
      `${t("app.title")} — ${t("source.notes")}`,
      refLabel,
    );
  };

  const backup = async () => {
    if (!(await flushOrWarn())) return;
    downloadJson("bible-notes.json", await exportNotes());
  };

  const imageError = (error: unknown) => {
    const key = error instanceof NoteImageError ? `notes.imageError.${error.code}` : "notes.imageError.unknown";
    window.alert(t(key));
  };

  const statusText =
    saveStatus === "error"
      ? t("notes.saveFailed")
      : saveStatus === "saving" || saveStatus === "pending"
        ? t("notes.saving")
        : t("notes.saved");

  return (
    <div className="pane notes-pane">
      <div className="pane-header notes-header">
        <SourceSelector type={pane.type} onChange={(type) => void flushOrWarn().then((ok) => ok && changePaneType(pane.id, type))} />
        <div className="notes-tabs" role="tablist" aria-label={t("source.notes")}>
          <button
            ref={topicTabRef}
            id={`${pane.id}-topics-tab`}
            type="button"
            role="tab"
            aria-selected={tab === "topic"}
            aria-controls={`${pane.id}-notes-panel`}
            tabIndex={tab === "topic" ? 0 : -1}
            className={tab === "topic" ? "active" : ""}
            onClick={() => void changeTab("topic")}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                passageTabRef.current?.focus();
                void changeTab("passage");
              }
            }}
          >
            {t("notes.topics")}
          </button>
          <button
            ref={passageTabRef}
            id={`${pane.id}-passages-tab`}
            type="button"
            role="tab"
            aria-selected={tab === "passage"}
            aria-controls={`${pane.id}-notes-panel`}
            tabIndex={tab === "passage" ? 0 : -1}
            className={tab === "passage" ? "active" : ""}
            onClick={() => void changeTab("passage")}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                topicTabRef.current?.focus();
                void changeTab("topic");
              }
            }}
          >
            {t("notes.passages")}
          </button>
        </div>
        {tab === "topic" ? (
          <button type="button" onClick={() => void newTopic()}>＋ {t("notes.newTopic")}</button>
        ) : (
          <button
            type="button"
            onClick={() => void noteOnPassage()}
            disabled={!biblePane}
            title={biblePane ? refLabel(biblePane.osis, biblePane.chapter) : t("notes.noPassage")}
          >
            ＋ {biblePane ? refLabel(biblePane.osis, biblePane.chapter) : t("notes.noPassage")}
          </button>
        )}
      </div>

      <div
        id={`${pane.id}-notes-panel`}
        className="notes-body"
        role="tabpanel"
        aria-labelledby={`${pane.id}-${tab === "topic" ? "topics" : "passages"}-tab`}
      >
        <ul className="notes-list">
          {list.length === 0 && <li className="muted">{t("notes.empty")}</li>}
          {list.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={note.id === activeId ? "note-item active" : "note-item"}
                onClick={() => void selectNote(note)}
              >
                {noteLabel(note)}
              </button>
            </li>
          ))}
        </ul>

        {active ? (
          <div className="note-editor-wrap">
            <div className="note-editor-head">
              {active.kind === "topic" ? (
                <input
                  className="note-title"
                  value={titleDraft}
                  aria-label={t("notes.title")}
                  maxLength={MAX_NOTE_TITLE_LENGTH}
                  onChange={(event) => onTitleChange(event.target.value)}
                />
              ) : (
                <span className="note-title-fixed">{noteLabel(active)}</span>
              )}
              <div className="note-actions">
                <button type="button" onClick={() => void printOne()}>{t("notes.exportPdf")}</button>
                <button type="button" className="danger" onClick={() => void removeActive()}>{t("notes.delete")}</button>
              </div>
            </div>
            <Suspense fallback={<p className="muted note-empty">{t("reader.loading")}</p>}>
              <RichTextEditor
                noteId={active.id}
                initialHtml={saveQueue.currentHtml(active.id, active.contentHtml)}
                onChange={onContentChange}
                onCommit={() => void saveQueue.flush(active.id)}
                onError={imageError}
              />
            </Suspense>
          </div>
        ) : (
          <p className="muted note-empty">{t("notes.selectOrCreate")}</p>
        )}
      </div>

      <div className="pane-footer notes-footer">
        <div>
          <span>{t(dropboxConnected ? "notes.localAndDropbox" : "notes.localOnly")}</span>{" "}
          <span className={saveStatus === "error" ? "save-status error" : "save-status"} title={saveError ? String(saveError) : undefined}>
            {statusText}
          </span>
          {storageBytes !== null && <span className="storage-usage"> · {t("notes.storageUsed", { size: (storageBytes / 1024 / 1024).toFixed(1) })}</span>}
          {lastDeleted && <button type="button" className="link-button" onClick={() => void undoDelete()}>{t("notes.undoDelete")}</button>}
        </div>
        <div className="notes-footer-actions">
          <button type="button" onClick={() => void printAll()}>{t("notes.exportAllPdf")}</button>
          <button type="button" onClick={() => void backup()}>{t("notes.backup")}</button>
          <button type="button" onClick={() => restoreInputRef.current?.click()}>{t("notes.restore")}</button>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json"
            aria-label={t("notes.restore")}
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.[0]) void restore(event.target.files[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </div>
  );
}
