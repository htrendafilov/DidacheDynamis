import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { sanitizeHtml } from "../notes/sanitize";

// contentEditable-based rich text editor. React does not manage the editable DOM: we set
// the HTML imperatively when the note changes and report edits back out. Content is
// sanitized on load and (by the caller) on save.
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function RichTextEditor({
  noteId,
  initialHtml,
  onChange,
}: {
  noteId: string;
  initialHtml: string;
  onChange: (html: string) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // Load content only when the selected note changes (avoids caret jumps while typing).
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeHtml(initialHtml);
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => {
    if (ref.current) onChange(ref.current.innerHTML);
  };

  const exec = (command: string, value?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, value);
    emit();
  };

  const insertImageFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await fileToDataUrl(file);
      ref.current?.focus();
      document.execCommand("insertImage", false, dataUrl);
    }
    emit();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (images.length) {
      e.preventDefault();
      void insertImageFiles(images);
    }
  };

  const btn = (label: string, title: string, action: () => void) => (
    <button type="button" className="rte-btn" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={action}>
      {label}
    </button>
  );

  return (
    <div className="rich-text-editor">
      <div className="rte-toolbar" role="toolbar" aria-label={t("notes.toolbar")}>
        {btn("B", t("notes.bold"), () => exec("bold"))}
        {btn("I", t("notes.italic"), () => exec("italic"))}
        {btn("U", t("notes.underline"), () => exec("underline"))}
        {btn("H2", t("notes.heading"), () => exec("formatBlock", "H2"))}
        {btn("H3", t("notes.subheading"), () => exec("formatBlock", "H3"))}
        {btn("¶", t("notes.paragraph"), () => exec("formatBlock", "P"))}
        {btn("• List", t("notes.bulletList"), () => exec("insertUnorderedList"))}
        {btn("1. List", t("notes.numberList"), () => exec("insertOrderedList"))}
        {btn("❝", t("notes.quote"), () => exec("formatBlock", "BLOCKQUOTE"))}
        {btn("🔗", t("notes.link"), () => {
          const url = window.prompt(t("notes.linkPrompt") ?? "URL");
          if (url) exec("createLink", url);
        })}
        <label className="rte-btn" title={t("notes.image")}>
          🖼
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void insertImageFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {btn("⤺", t("notes.undo"), () => exec("undo"))}
      </div>
      <div
        ref={ref}
        className="rte-content"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("notes.editor")}
        onInput={emit}
        onBlur={emit}
        onPaste={onPaste}
      />
    </div>
  );
}
