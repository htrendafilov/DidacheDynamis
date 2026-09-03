import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

import { prepareNoteImage } from "../notes/images";
import { sanitizeHtml } from "../notes/sanitize";

export function RichTextEditor({
  noteId,
  initialHtml,
  onChange,
  onCommit,
  onError,
}: {
  noteId: string;
  initialHtml: string;
  onChange: (html: string) => void;
  onCommit: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const noteIdRef = useRef(noteId);
  const initialHtmlRef = useRef(initialHtml);
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const onErrorRef = useRef(onError);
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  onErrorRef.current = onError;
  initialHtmlRef.current = initialHtml;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ allowBase64: true }),
    ],
    content: sanitizeHtml(initialHtml),
    editorProps: {
      attributes: {
        class: "rte-content",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
    onBlur: () => onCommitRef.current(),
  });

  useEffect(() => {
    noteIdRef.current = noteId;
    editor?.commands.setContent(sanitizeHtml(initialHtmlRef.current), { emitUpdate: false });
  }, [editor, noteId]);

  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: {
          class: "rte-content",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": t("notes.editor"),
        },
      },
    });
  }, [editor, t]);

  if (!editor) return null;

  const button = (
    label: string,
    title: string,
    active: boolean,
    action: () => void,
  ) => (
    <button
      type="button"
      className={active ? "rte-btn active" : "rte-btn"}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={action}
    >
      {label}
    </button>
  );

  const insertImageFiles = async (files: FileList) => {
    const targetNote = noteId;
    try {
      for (const file of Array.from(files)) {
        const src = await prepareNoteImage(file);
        if (noteIdRef.current !== targetNote) return;
        editor.chain().focus().setImage({ src, alt: file.name }).run();
      }
      onCommitRef.current();
    } catch (error) {
      onErrorRef.current(error);
    }
  };

  return (
    <div className="rich-text-editor">
      <div className="rte-toolbar" role="toolbar" aria-label={t("notes.toolbar")}>
        {button("B", t("notes.bold"), editor.isActive("bold"), () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {button("I", t("notes.italic"), editor.isActive("italic"), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {button("U", t("notes.underline"), editor.isActive("underline"), () =>
          editor.chain().focus().toggleUnderline().run(),
        )}
        {button("H2", t("notes.heading"), editor.isActive("heading", { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {button("H3", t("notes.subheading"), editor.isActive("heading", { level: 3 }), () =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
        )}
        {button("¶", t("notes.paragraph"), editor.isActive("paragraph"), () =>
          editor.chain().focus().setParagraph().run(),
        )}
        {button("• List", t("notes.bulletList"), editor.isActive("bulletList"), () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {button("1. List", t("notes.numberList"), editor.isActive("orderedList"), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
        {button("❝", t("notes.quote"), editor.isActive("blockquote"), () =>
          editor.chain().focus().toggleBlockquote().run(),
        )}
        {button("🔗", t("notes.link"), editor.isActive("link"), () => {
          const url = window.prompt(t("notes.linkPrompt") ?? "URL", editor.getAttributes("link").href);
          if (url === null) return;
          if (!url.trim()) editor.chain().focus().unsetLink().run();
          else editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
        })}
        <button
          type="button"
          className="rte-btn"
          aria-label={t("notes.image")}
          title={t("notes.image")}
          onClick={() => inputRef.current?.click()}
        >
          🖼
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          onChange={(event) => {
            if (event.target.files?.length) void insertImageFiles(event.target.files);
            event.target.value = "";
          }}
        />
        {button("⤺", t("notes.undo"), false, () => editor.chain().focus().undo().run())}
      </div>
      <EditorContent className="rte-editor-content" editor={editor} />
    </div>
  );
}
