import { execSync } from "node:child_process";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// A unique id per build, used to detect stale open tabs after a deploy (see UpdateNotice). Prefer an
// explicit VITE_BUILD_ID (CI/Docker set it to the commit SHA), then the local git SHA for
// traceability, and only fall back to a timestamp when git is unavailable (e.g. a bare container).
function resolveBuildId(): string {
  const fromEnv = process.env.VITE_BUILD_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return new Date().toISOString();
  }
}

const buildId = resolveBuildId();

// Dev server proxies API calls to the FastAPI backend on :8080.
export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      name: "emit-build-version",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "version.json",
          source: `${JSON.stringify({ buildId })}\n`,
        });
      },
    },
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/health": "http://localhost:8080",
      "/ready": "http://localhost:8080",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"], // unit tests only; e2e/ is Playwright
    // Must clear setup.ts's asyncUtilTimeout (5s), or a slow findBy* trips vitest's own
    // 5s default first and reports a bare test timeout instead of the element it wanted.
    testTimeout: 20000,
  },
});
