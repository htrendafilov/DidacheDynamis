import { expect, type Page } from "@playwright/test";

// Shared by the Assistant e2e specs. No live provider calls: every OpenRouter request is
// intercepted and mocked; the app's own /api/v1 routes are real.
export const SEED = {
  state: {
    panes: [{ id: "p1", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    settings: {
      verseLayout: "per-line",
      wordsOfChrist: "off",
      theme: "light",
      fontScale: 1,
      uiLang: "en",
      sync: true,
      bookMode: "paged",
    },
  },
  version: 0,
};

export const SENTINEL_KEY = "sk-or-v1-E2ESENTINEL0123456789";

export async function mockOpenRouter(page: Page) {
  await page.route("https://openrouter.ai/api/v1/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "openrouter/free",
            name: "Free Models Router",
            context_length: 200000,
            pricing: { prompt: "0", completion: "0" },
            supported_parameters: ["tools"],
          },
        ],
      }),
    }),
  );
  await page.route("https://openrouter.ai/api/v1/key", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { label: "e2e", limit: 10, limit_remaining: 9, is_free_tier: true },
      }),
    }),
  );
  await page.route("https://openrouter.ai/api/v1/chat/completions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        'data: {"model":"cohere/north-mini-code:free","choices":[{"delta":{"content":"Hello, "}}]}',
        "",
        'data: {"choices":[{"delta":{"content":"world."},"finish_reason":"stop"}],"usage":{"total_tokens":10}}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join("\n"),
    }),
  );
}

// Connect with the sentinel key and pick the mocked router model. Provider/model settings
// live behind the composer's model chip (plan/chat/m9.3b-chat-layout.md); selecting a
// model closes the popover.
export async function connectAndSelectModel(page: Page) {
  await page.getByRole("button", { name: "Select a model" }).click();
  await expect(page.getByRole("option", { name: /Free Models Router/ })).toBeAttached();
  await page.getByRole("checkbox", { name: /eligible OpenRouter account/i }).check();
  await page.getByLabel("OpenRouter API key").fill(SENTINEL_KEY);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected to OpenRouter.")).toBeVisible();
  await page.getByRole("option", { name: /Free Models Router/ }).click();
}
