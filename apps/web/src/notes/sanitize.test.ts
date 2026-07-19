import { describe, expect, it } from "vitest";

import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("keeps rich text formatting", () => {
    const html = "<p><strong>bold</strong> <em>italic</em></p><ul><li>one</li></ul>";
    expect(sanitizeHtml(html)).toContain("<strong>bold</strong>");
    expect(sanitizeHtml(html)).toContain("<li>one</li>");
  });

  it("strips script and event handlers", () => {
    expect(sanitizeHtml("<p>ok</p><script>alert(1)</script>")).not.toContain("script");
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA" onerror="alert(1)">')).not.toContain(
      "onerror",
    );
  });

  it("allows inline raster data-URL images", () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
    expect(out).toContain("data:image/png;base64");
  });

  it("drops javascript: and data:svg image sources", () => {
    expect(sanitizeHtml('<img src="javascript:alert(1)">')).not.toContain("javascript:");
    expect(sanitizeHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).not.toContain("svg+xml");
  });
});
