import { describe, expect, it } from "vitest";

import { ALL_PROVIDERS, getProvider } from "./providers";

// The single source of truth for the deployed connect-src is the exact-match assertion
// in apps/api/tests/test_api.py::test_csp_connect_src_is_an_exact_allowlist, which reads
// the real apps/api/app/main.py CSP string and would fail on any drift there. This test
// only has to agree with that known-good value — duplicated here rather than read via
// node:fs so the web test suite stays free of Node-only type dependencies.
const DEPLOYED_CONNECT_SRC =
  "connect-src 'self' https://api.dropboxapi.com https://content.dropboxapi.com https://openrouter.ai";

describe("provider registry", () => {
  it("every provider's cspOrigin is present in the deployed connect-src", () => {
    for (const provider of ALL_PROVIDERS) {
      expect(DEPLOYED_CONNECT_SRC, `${provider.id} cspOrigin missing from connect-src`).toContain(
        provider.cspOrigin,
      );
    }
  });

  it("exposes exactly the OpenRouter provider", () => {
    expect(ALL_PROVIDERS.map((p) => p.id)).toEqual(["openrouter"]);
  });

  it("validatePath is distinct from modelsPath", () => {
    // m9.0-findings.md §11: GET /models needs no auth and returns 200 for any key,
    // so validating a pasted key through it would accept anything, including empty.
    const openrouter = getProvider("openrouter");
    expect(openrouter.validatePath).not.toBe(openrouter.modelsPath);
    expect(openrouter.validatePath).toBe("/key");
    expect(openrouter.modelsNeedAuth).toBe(false);
  });

  describe("suppressReasoning", () => {
    it("sends the disable flag when capabilities are unknown (dynamic router)", () => {
      const body: Record<string, unknown> = {};
      getProvider("openrouter").suppressReasoning(body, null);
      expect(body.reasoning).toEqual({ enabled: false });
    });

    it("sends the disable flag when reasoning is known and not mandatory", () => {
      const body: Record<string, unknown> = {};
      getProvider("openrouter").suppressReasoning(body, { mandatory: false });
      expect(body.reasoning).toEqual({ enabled: false });
    });

    it("does not send a disable flag when reasoning is mandatory", () => {
      const body: Record<string, unknown> = {};
      getProvider("openrouter").suppressReasoning(body, { mandatory: true });
      expect(body.reasoning).toBeUndefined();
    });
  });
});
