import type { Note } from "../data/notes";
import { sanitizeHtml } from "./sanitize";

// "Export PDF" uses the browser's own print engine (via a hidden iframe), which preserves
// rich formatting and inline images with high fidelity and needs no external library.
// The user picks "Save as PDF" in the print dialog.

function escapeText(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

const PRINT_CSS = `
  @page { margin: 18mm; }
  * { box-sizing: border-box; }
  body { font: 12pt/1.6 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
  .note { page-break-after: always; }
  .note:last-child { page-break-after: auto; }
  .note h1 { font-size: 18pt; margin: 0 0 2pt; }
  .note .ref { color: #555; font-style: italic; margin: 0 0 12pt; }
  .note img { max-width: 100%; height: auto; }
  .note blockquote { border-left: 3px solid #ccc; margin: 0 0 0 8pt; padding-left: 10pt; color: #333; }
  .note h2 { font-size: 14pt; } .note h3 { font-size: 12.5pt; }
`;

export function printNotesToPdf(
  notes: Note[],
  documentTitle: string,
  refLabel: (osis: string, chapter: number) => string,
): void {
  const printable = notes.filter((n) => n.contentHtml.trim() || n.title.trim());
  if (!printable.length) return;

  const sections = printable
    .map((n) => {
      const heading = escapeText(n.title || "Untitled");
      const ref =
        n.kind === "passage" && n.osis && n.chapter
          ? `<p class="ref">${escapeText(refLabel(n.osis, n.chapter))}</p>`
          : "";
      return `<section class="note"><h1>${heading}</h1>${ref}<div>${sanitizeHtml(n.contentHtml)}</div></section>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(
    documentTitle,
  )}</title><style>${PRINT_CSS}</style></head><body>${sections}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 1000);
  };
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
}
