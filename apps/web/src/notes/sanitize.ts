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

// Restrict image sources to http(s) or inline raster data-URLs. DOMPurify allows data: on
// <img> for any subtype by default, so we explicitly drop data:image/svg+xml (can carry script)
// and anything else (javascript:, etc.).
const SAFE_IMG_SRC = /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "IMG") {
    const src = node.getAttribute("src");
    if (src && !SAFE_IMG_SRC.test(src)) node.removeAttribute("src");
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as string;
}
