import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

// M9.4: the expansion fan-out issues up to five searches per turn under one AbortController,
// so api.search has to forward the signal like api.passage does — otherwise Stop leaves the
// GETs running.
describe("api.search", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: "q", refine: null, sort: "relevance", total: 0, groups: [] })));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the signal to fetch and keeps it out of the query string", async () => {
    const signal = new AbortController().signal;
    await api.search("resurrection", { sort: "relevance", signal });
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBe(signal);
    expect(url).toBe("/api/v1/search?q=resurrection&sort=relevance");
  });

  it("sends no signal when none is given", async () => {
    await api.search("resurrection");
    expect(fetchMock.mock.calls[0][1]).toEqual({ signal: undefined });
  });
});
