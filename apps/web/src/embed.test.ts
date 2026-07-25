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
      parseRef: (
        value: string,
      ) => { osis: string; chapter: number; start: number | null; end: number | null } | null;
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

  // The widget accepts exactly what the app's own parser accepts, so a reference copied out of
  // a dictionary entry works verbatim in data-bible-ref.
  it("parses a chapter-only reference without fabricating verse 1", () => {
    expect(embed().parseRef("Num.12")).toEqual({
      osis: "Num",
      chapter: 12,
      start: null,
      end: null,
    });
    expect(embed().parseRef("Num.0")).toBeNull();
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

  it("previews a chapter-only ref from a bounded window and marks it truncated", async () => {
    const verses = Array.from({ length: 6 }, (_unused, index) => ({
      verse: index + 1,
      lines: [{ runs: [{ t: `Verse ${index + 1}.` }] }],
    }));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ verses }),
    });
    vi.stubGlobal("fetch", fetchMock);

    document.body.innerHTML = '<span data-bible-ref="Num.12">Numbers 12</span>';
    const span = document.querySelector("span")!;
    embed().enhance(document);

    span.dispatchEvent(new MouseEvent("mouseenter"));
    // Never the whole chapter: this fires on hover, on someone else's page.
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/v1/works/web/passage/Num/12?verses=1-6`);

    const pop = document.querySelector(".bible-embed-pop") as HTMLElement;
    const link = pop.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`${origin}/#/b/web/Num/12`);
    await vi.waitFor(() => expect(pop.textContent).toContain("Verse 6. …"));
  });

  it("does not let a stale in-flight fetch overwrite a cached reference", async () => {
    let resolveSlow: ((value: unknown) => void) | undefined;
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url.includes("verses=1")
        ? new Promise((done) => {
            resolveSlow = done;
          })
        : Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ verses: [{ verse: 9, lines: [{ runs: [{ t: "Cached." }] }] }] }),
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    document.body.innerHTML =
      '<span id="slow" data-bible-ref="John.3.1">a</span>' +
      '<span id="warm" data-bible-ref="John.3.9">b</span>';
    embed().enhance(document);
    const slow = document.querySelector("#slow")!;
    const warm = document.querySelector("#warm")!;

    // Warm the cache for the second reference, then start a request that never resolves yet.
    warm.dispatchEvent(new MouseEvent("mouseenter"));
    const pop = document.querySelector(".bible-embed-pop") as HTMLElement;
    await vi.waitFor(() => expect(pop.textContent).toContain("Cached."));
    slow.dispatchEvent(new MouseEvent("mouseenter"));
    warm.dispatchEvent(new MouseEvent("mouseenter"));
    expect(pop.textContent).toContain("Cached.");

    resolveSlow?.({
      ok: true,
      json: () => Promise.resolve({ verses: [{ verse: 1, lines: [{ runs: [{ t: "Stale." }] }] }] }),
    });
    // Drain the fetch -> json -> render microtask chain; the point of the test is that nothing
    // changes, so there is no positive signal to wait for.
    for (let tick = 0; tick < 3; tick += 1) {
      await new Promise((done) => setTimeout(done, 0));
    }
    expect(pop.textContent).toContain("Cached.");
    expect(pop.textContent).not.toContain("Stale.");
  });

  it("ignores an unparseable data-bible-ref", () => {
    document.body.innerHTML = '<span data-bible-ref="nope">x</span>';
    const span = document.querySelector("span")!;
    embed().enhance(document);
    expect(span.getAttribute("role")).toBeNull();
  });
});
