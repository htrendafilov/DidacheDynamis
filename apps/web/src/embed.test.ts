import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Vite inlines the real standalone script as a string (?raw) so we evaluate exactly what ships.
import embedSource from "../public/embed.js?raw";

// The embed is a standalone, dependency-free browser script; evaluate the real file in jsdom and
// exercise the API it exposes on window (document.currentScript is null here, so it falls back to
// window.location.origin, which vitest sets to http://localhost:3000).
declare global {
  interface Window {
    BibleEmbed?: {
      enhance: (root?: ParentNode) => void;
      parseRef: (value: string) => { osis: string; chapter: number; start: number; end: number } | null;
      passageText: (passage: unknown) => string;
    };
    __bibleEmbedLoaded?: boolean;
  }
}

beforeAll(() => {
  new Function(embedSource)();
});

const embed = () => window.BibleEmbed!;

describe("embed.js parsing", () => {
  it("parses references and rejects malformed ones", () => {
    expect(embed().parseRef("John.3.16")).toEqual({ osis: "John", chapter: 3, start: 16, end: 16 });
    expect(embed().parseRef("1Cor.13.4-7")).toMatchObject({ osis: "1Cor", start: 4, end: 7 });
    expect(embed().parseRef("garbage")).toBeNull();
    expect(embed().parseRef("John.3.5-3")).toBeNull();
  });

  it("joins verse runs into plain text", () => {
    const text = embed().passageText({
      verses: [
        { verse: 16, lines: [{ runs: [{ t: "For God " }, { t: "so loved" }] }] },
        { verse: 17, lines: [{ runs: [{ t: "the world." }] }] },
      ],
    });
    expect(text).toBe("16 For God so loved 17 the world.");
  });
});

describe("embed.js DOM behavior", () => {
  const origin = window.location.origin;

  beforeEach(() => {
    document.body.innerHTML = "";
    document.querySelector(".bible-embed-pop")?.remove();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks up refs, fetches on hover, and links into the app", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ verses: [{ verse: 16, lines: [{ runs: [{ t: "For God so loved." }] }] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    document.body.innerHTML = '<span data-bible-ref="John.3.16">John 3:16</span>';
    const span = document.querySelector("span")!;
    embed().enhance(document);
    expect(span.getAttribute("role")).toBe("button");

    span.dispatchEvent(new MouseEvent("mouseenter"));
    expect(fetchMock).toHaveBeenCalledWith(
      `${origin}/api/v1/works/web/passage/John/3?verses=16`,
    );

    const pop = document.querySelector(".bible-embed-pop") as HTMLElement;
    expect(pop.hidden).toBe(false);
    const link = pop.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`${origin}/#/b/web/John/3`);

    await vi.waitFor(() =>
      expect(pop.textContent).toContain("For God so loved."),
    );
  });

  it("ignores an unparseable data-bible-ref", () => {
    document.body.innerHTML = '<span data-bible-ref="nope">x</span>';
    const span = document.querySelector("span")!;
    embed().enhance(document);
    expect(span.getAttribute("role")).toBeNull();
  });
});
