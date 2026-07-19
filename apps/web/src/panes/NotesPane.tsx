import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLiveQuery } from "dexie-react-hooks";

import { RichTextEditor } from "../components/RichTextEditor";
import { SourceSelector } from "../components/SourceSelector";
import {
  createTopic,
  db,
  deleteNote,
  ensurePassageNote,
  exportNotes,
  importNotes,
  type Note,
  updateNote,
} from "../data/notes";
import { bookName } from "../i18n/bookNames";
import { printNotesToPdf } from "../notes/print";
import { sanitizeHtml } from "../notes/sanitize";
import { useStore, type Pane } from "../state/store";

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function NotesPane({ pane }: { pane: Pane }) {
  const { t, i18n } = useTranslation();
  const panes = useStore((s) => s.panes);
  const goToRef = useStore((s) => s.goToRef);
  const changePaneType = useStore((s) => s.changePaneType);

  const notes = useLiveQuery(() => db.notes.orderBy("updatedAt").reverse().toArray(), []) ?? [];
  const [tab, setTab] = useState<"topic" | "passage">("topic");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const biblePane = panes.find((p) => p.type === "bible");
  const refLabel = (osis: string, chapter: number) => `${bookName(osis, i18n.language, osis)} ${chapter}`;
  const noteLabel = (n: Note) =>
    n.kind === "passage" && n.osis && n.chapter ? refLabel(n.osis, n.chapter) : n.title || t("notes.untitled");

  const topics = notes.filter((n) => n.kind === "topic");
  const passages = notes.filter((n) => n.kind === "passage");
  const active = notes.find((n) => n.id === activeId) ?? null;

  useEffect(() => {
    setTitleDraft(active?.title ?? "");
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectNote = (n: Note) => {
    setActiveId(n.id);
    setTitleDraft(n.title);
    if (n.kind === "passage" && n.osis && n.chapter) goToRef(n.osis, n.chapter, biblePane?.id);
  };

  const onContentChange = (html: string) => {
    if (!activeId) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void updateNote(activeId, { contentHtml: sanitizeHtml(html) }), 400);
  };

  const onTitleChange = (value: string) => {
    setTitleDraft(value);
    if (activeId) void updateNote(activeId, { title: value });
  };

  const newTopic = async () => {
    const title = window.prompt(t("notes.newTopicPrompt") ?? "Topic");
    if (!title?.trim()) return;
    const id = await createTopic(title);
    setTab("topic");
    setActiveId(id);
    setTitleDraft(title.trim());
  };

  const noteOnPassage = async () => {
    if (!biblePane) return;
    const id = await ensurePassageNote(biblePane.osis, biblePane.chapter, refLabel(biblePane.osis, biblePane.chapter));
    setTab("passage");
    setActiveId(id);
  };

  const del = async () => {
    if (!activeId) return;
    await deleteNote(activeId);
    setActiveId(null);
  };

  const restore = async (file: File) => {
    try {
      const count = await importNotes(JSON.parse(await file.text()));
      window.alert(t("notes.restored", { count }));
    } catch {
      window.alert(t("notes.restoreFailed"));
    }
  };

  const list = tab === "topic" ? topics : passages;

  return (
    <div className="pane notes-pane">
      <div className="pane-header notes-header">
        <SourceSelector type={pane.type} onChange={(type) => changePaneType(pane.id, type)} />
        <div className="notes-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "topic"}
            className={tab === "topic" ? "active" : ""} onClick={() => setTab("topic")}>
            {t("notes.topics")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "passage"}
            className={tab === "passage" ? "active" : ""} onClick={() => setTab("passage")}>
            {t("notes.passages")}
          </button>
        </div>
        {tab === "topic" ? (
          <button type="button" onClick={newTopic}>＋ {t("notes.newTopic")}</button>
        ) : (
          <button type="button" onClick={noteOnPassage} disabled={!biblePane}
            title={biblePane ? refLabel(biblePane.osis, biblePane.chapter) : t("notes.noPassage")}>
            ＋ {biblePane ? refLabel(biblePane.osis, biblePane.chapter) : t("notes.noPassage")}
          </button>
        )}
      </div>

      <div className="notes-body">
        <ul className="notes-list">
          {list.length === 0 && <li className="muted">{t("notes.empty")}</li>}
          {list.map((n) => (
            <li key={n.id}>
              <button type="button" className={n.id === activeId ? "note-item active" : "note-item"}
                onClick={() => selectNote(n)}>
                {noteLabel(n)}
              </button>
            </li>
          ))}
        </ul>

        {active ? (
          <div className="note-editor-wrap">
            <div className="note-editor-head">
              {active.kind === "topic" ? (
                <input className="note-title" value={titleDraft} aria-label={t("notes.title")}
                  onChange={(e) => onTitleChange(e.target.value)} />
              ) : (
                <span className="note-title-fixed">{noteLabel(active)}</span>
              )}
              <div className="note-actions">
                <button type="button" onClick={() => printNotesToPdf([active], noteLabel(active), refLabel)}>
                  {t("notes.exportPdf")}
                </button>
                <button type="button" className="danger" onClick={del}>{t("notes.delete")}</button>
              </div>
            </div>
            <RichTextEditor noteId={active.id} initialHtml={active.contentHtml} onChange={onContentChange} />
          </div>
        ) : (
          <p className="muted note-empty">{t("notes.selectOrCreate")}</p>
        )}
      </div>

      <div className="pane-footer notes-footer">
        <span>{t("notes.localOnly")}</span>
        <div className="notes-footer-actions">
          <button type="button" onClick={() => printNotesToPdf(notes, `${t("app.title")} — ${t("source.notes")}`, refLabel)}>
            {t("notes.exportAllPdf")}
          </button>
          <button type="button" onClick={async () => downloadJson("bible-notes.json", await exportNotes())}>
            {t("notes.backup")}
          </button>
          <label className="linklike">
            {t("notes.restore")}
            <input type="file" accept="application/json" hidden
              onChange={(e) => {
                if (e.target.files?.[0]) void restore(e.target.files[0]);
                e.target.value = "";
              }} />
          </label>
        </div>
      </div>
    </div>
  );
}
