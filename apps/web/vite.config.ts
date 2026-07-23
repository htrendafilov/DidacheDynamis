import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const buildId = process.env.VITE_BUILD_ID?.trim() || new Date().toISOString();

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
  },
});
