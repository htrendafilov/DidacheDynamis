import DOMPurify from "dompurify";

// Notes are the user's own content, but we still sanitize on save/render/export so pasted
// markup can never execute script.
const CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "span", "div",
    "b", "strong", "i", "em", "u", "s", "mark", "sub", "sup",
    "h1", "h2", "h3", "h4",
    "ul", "ol", "li",
    "blockquote", "code", "pre",
    "a", "img",
  ],
  ALLOWED_ATTR: ["href", "title", "target", "rel", "src", "alt", "width", "height"],
};

// Notes are private and local. Remote images would contact a third party whenever a note is
// opened or printed, so only bounded inline raster formats are retained.
const SAFE_IMG_SRC = /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "IMG") {
    const src = node.getAttribute("src");
    if (!src || !SAFE_IMG_SRC.test(src)) node.remove();
  }
  if (node.nodeName === "A" && node.getAttribute("target") === "_blank") {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as string;
}
