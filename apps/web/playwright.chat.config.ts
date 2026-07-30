import { defineConfig, devices } from "@playwright/test";

// A separate config for the M9.2 Assistant, which sits behind VITE_CHAT_ENABLED and is
// off in the default e2e build (plan/interactive_chat_plan.md §7.3 — must not be
// reachable until M9.3 exits). Run explicitly with `npm run e2e:chat`.
//
// Reuses the same scripts/e2e-server.sh as playwright.config.ts, on a different port, with
// VITE_CHAT_ENABLED=true added to its environment — Vite picks up VITE_-prefixed process
// env vars at build time. Both configs' webServer scripts rebuild the same apps/web/dist
// and data/content.sqlite, so do not run this alongside `npm run e2e` at the same time;
// run them sequentially (each rebuilds what the other left behind, which is correct for
// that run, just not safe concurrently).
const PORT = Number(process.env.E2E_CHAT_PORT ?? 4322);

export default defineConfig({
  testDir: "./e2e-chat",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bash ../../scripts/e2e-server.sh",
    url: `http://127.0.0.1:${PORT}/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT), VITE_CHAT_ENABLED: "true" },
  },
});
