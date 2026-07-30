import { expect, type Page, test } from "@playwright/test";

// M9.2 Assistant e2e, run with `npm run e2e:chat` against a build with VITE_CHAT_ENABLED=true
// (see ../playwright.chat.config.ts). No live provider calls: every OpenRouter request is
// intercepted and mocked.

const SEED = {
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

const SENTINEL_KEY = "sk-or-v1-E2ESENTINEL0123456789";

async function mockOpenRouter(page: Page) {
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
});

test("no chat chunk is requested until Assistant is opened", async ({ page }) => {
  const chatChunkRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/ChatWorkspace-[^/]+\.js/.test(request.url())) {
      chatChunkRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder("Search the text…")).toBeVisible();

  expect(chatChunkRequests).toEqual([]);

  await mockOpenRouter(page);
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("heading", { name: "Study Assistant" })).toBeVisible();
  await expect.poll(() => chatChunkRequests.length).toBeGreaterThan(0);
});

test("connect, pick a model, send a message, stream it, and disconnect", async ({ page }) => {
  await mockOpenRouter(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Assistant" }).click();

  await expect(page.getByRole("option", { name: /Free Models Router/ })).toBeAttached();

  await page
    .getByRole("checkbox", { name: /eligible OpenRouter account/i })
    .check();
  await page.getByLabel("OpenRouter API key").fill(SENTINEL_KEY);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected to OpenRouter.")).toBeVisible();

  // The key never renders anywhere once connected.
  await expect(page.getByLabel("OpenRouter API key")).not.toBeAttached();
  expect(await page.content()).not.toContain(SENTINEL_KEY);

  await page.getByLabel("Model", { exact: true }).selectOption("openrouter/free");
  await page.getByLabel("Your question").fill("Explain John 3:16");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Hello, world.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
});

test("Stop cancels an in-flight request immediately, without waiting for a response", async ({
  page,
}) => {
  await mockOpenRouter(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Assistant" }).click();
  await expect(page.getByRole("option", { name: /Free Models Router/ })).toBeAttached();

  await page
    .getByRole("checkbox", { name: /eligible OpenRouter account/i })
    .check();
  await page.getByLabel("OpenRouter API key").fill(SENTINEL_KEY);
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected to OpenRouter.")).toBeVisible();
  await page.getByLabel("Model", { exact: true }).selectOption("openrouter/free");

  // Replace the completions mock with one that never responds, so nothing but a real Stop
  // click can end this request -- proves Stop cancels the actual network request, not just
  // something the UI stops listening to.
  await page.unroute("https://openrouter.ai/api/v1/chat/completions");
  await page.route("https://openrouter.ai/api/v1/chat/completions", () => {
    // Deliberately never calls fulfill/continue/abort.
  });

  await page.getByLabel("Your question").fill("Explain John 3:16");

  const [failedRequest] = await Promise.all([
    page.waitForEvent(
      "requestfailed",
      (req) => req.url() === "https://openrouter.ai/api/v1/chat/completions",
    ),
    (async () => {
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
      await page.getByRole("button", { name: "Stop" }).click();
    })(),
  ]);
  expect(failedRequest.failure()?.errorText ?? "").toMatch(/abort/i);

  // Takes effect immediately: the route above never resolves, so this can only pass if
  // Stop -- not a response -- is what ended the request.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByText("Hello, world.")).not.toBeVisible();
});

test("Escape closes the Assistant and returns focus to its TopBar button", async ({ page }) => {
  await mockOpenRouter(page);
  await page.goto("/");
  const assistantButton = page.getByRole("button", { name: "Assistant" });
  await assistantButton.click();
  await expect(page.getByRole("heading", { name: "Study Assistant" })).toBeVisible();

  await page.keyboard.press("Escape");
  // Deliberately NOT page.getByRole() here: aria-hidden="true" removes the whole subtree
  // from the accessibility tree, so a role-based query finds nothing and any assertion
  // on it passes trivially -- true regardless of whether CSS actually hides the drawer.
  // A raw CSS-class locator bypasses ARIA filtering and checks the real rendered state.
  await expect(page.locator(".chat-drawer")).toHaveClass(/\bclosed\b/);
  await expect(page.locator(".chat-drawer")).not.toBeVisible();
  await expect(assistantButton).toBeFocused();
});

test("reader deep links still resolve with the Assistant flag enabled", async ({ page }) => {
  await page.goto("/#/b/web/John/1");
  await expect(page.getByText("In the beginning was the Word")).toBeVisible();
});
