import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearKey,
  connectedProviders,
  disconnect,
  getKey,
  getLoggingConfirmed,
  satisfiesNoTraining,
  setKey,
  setLoggingConfirmed,
} from "./credentials";

const SENTINEL = "sk-or-v1-TESTSENTINEL0123456789";

describe("chat credentials", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("round-trips through sessionStorage", () => {
    expect(getKey("openrouter")).toBeNull();
    setKey("openrouter", SENTINEL);
    expect(getKey("openrouter")).toBe(SENTINEL);
    clearKey("openrouter");
    expect(getKey("openrouter")).toBeNull();
  });

  it("never writes to localStorage", () => {
    setKey("openrouter", SENTINEL);
    expect(localStorage.length).toBe(0);
    expect(JSON.stringify(localStorage)).not.toContain(SENTINEL);
  });

  it("connectedProviders reflects only providers with a stored key", () => {
    expect(connectedProviders()).toEqual([]);
    setKey("openrouter", SENTINEL);
    expect(connectedProviders()).toEqual(["openrouter"]);
    clearKey("openrouter");
    expect(connectedProviders()).toEqual([]);
  });

  it("uses a provider-scoped storage key, not a shared one", () => {
    setKey("openrouter", SENTINEL);
    expect(sessionStorage.getItem("bible-chat-key-openrouter")).toBe(SENTINEL);
  });

  describe("no-training eligibility (§1b, §3a)", () => {
    it("defaults the logging confirmation to false", () => {
      expect(getLoggingConfirmed()).toBe(false);
    });

    it("persists the confirmation in sessionStorage, not just component state", () => {
      setLoggingConfirmed(true);
      expect(sessionStorage.getItem("bible-chat-logging-confirmed-openrouter")).toBe("1");
      expect(getLoggingConfirmed()).toBe(true);
      setLoggingConfirmed(false);
      expect(getLoggingConfirmed()).toBe(false);
    });

    it("requires both privacy routing AND the logging confirmation", () => {
      expect(satisfiesNoTraining(false)).toBe(false);
      expect(satisfiesNoTraining(true)).toBe(false); // confirmation still unset
      setLoggingConfirmed(true);
      expect(satisfiesNoTraining(false)).toBe(false); // routing off, even confirmed
      expect(satisfiesNoTraining(true)).toBe(true);
    });

    it("disconnect clears both the key and the logging confirmation", () => {
      setKey("openrouter", SENTINEL);
      setLoggingConfirmed(true);
      disconnect("openrouter");
      expect(getKey("openrouter")).toBeNull();
      expect(getLoggingConfirmed()).toBe(false);
    });
  });
});
