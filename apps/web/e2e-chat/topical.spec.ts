import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { connectAndSelectModel, mockOpenRouter, SEED } from "./helpers";

// M9.4 topical turn end to end (plan/chat/m9.4-topical-questions.md §"Tests", E2E). Both
// model calls are mocked SSE; the searches and the Path A fetches go to the real /api/v1
// over the e2e server's built database, so the confirmed terms genuinely hit the corpus.
const COMPLETIONS = "https://openrouter.ai/api/v1/chat/completions";
const SEARCH = /\/api\/v1\/search\?/;
const QUESTION = "Къде се говори за възкресение?";
const TERMS = ["resurrection", "risen"];

const sse = (events: object[]) =>
  events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\ndata: [DONE]\n\n";

// Two model calls per turn. The expansion is the one with max_tokens 200 (expand.ts) and
// returns the term list; the other returns the answer, citing S2 — the first search-found
// source, since S1 is the reader's own open chapter (kind order, then insertion order).
async function mockTopicalCompletions(page: Page, answer = "Христос възкръсна [S2].") {
  await page.unroute(COMPLETIONS);
  await page.route(COMPLETIONS, (route) => {
    const body = route.request().postDataJSON() as { max_tokens?: number };
    const events =
      body.max_tokens === 200
        ? [
            {
              model: "expander/model",
              choices: [{ delta: { content: JSON.stringify(TERMS) } }],
              usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
            },
          ]
        : [
            {
              model: "answerer/model",
              choices: [{ delta: { content: answer }, finish_reason: "stop" }],
              usage: { prompt_tokens: 900, completion_tokens: 100, total_tokens: 1000 },
            },
          ];
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(events) });
  });
}

async function openAssistantWithSearch(page: Page) {
  await mockOpenRouter(page);
  await mockTopicalCompletions(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Assistant" }).click();
  await connectAndSelectModel(page);
  await page.getByRole("checkbox", { name: "Search the library" }).check();
  // The pre-send affordance says a search runs first (§5).
  await expect(page.locator(".chat-context-strip > summary")).toContainText("a library search runs first");
}

async function send(page: Page) {
  await page.getByLabel("Your question").fill(QUESTION);
  await page.getByRole("button", { name: "Send" }).click();
}

const confirmRegion = (page: Page) => page.getByRole("region", { name: "Search terms" });
const messageRows = (page: Page) => page.locator(".chat-messages > li");

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
});

test("a topical question: terms are confirmed before anything is searched, the answer cites a search-found source, and the citation opens the reader", async ({
  page,
}) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    if (SEARCH.test(request.url())) searches.push(new URL(request.url()).searchParams.get("q") ?? "");
  });
  await openAssistantWithSearch(page);
  await send(page);

  // Confirm: the proposed terms, the English-scope statement, neither Send nor Stop, and
  // nothing searched yet.
  const region = confirmRegion(page);
  await expect(region).toBeVisible();
  await expect(region).toContainText("resurrection");
  await expect(region).toContainText("risen");
  await expect(region).toContainText("search of English content");
  await expect(page.getByRole("button", { name: "Send" })).not.toBeAttached();
  await expect(page.getByRole("button", { name: "Stop" })).not.toBeAttached();
  await expect(messageRows(page)).toHaveCount(0);
  expect(searches).toEqual([]);

  // Edits change what is searched: one search per confirmed term, the removed one never.
  await region.getByRole("button", { name: "Remove risen" }).click();
  await region.getByRole("button", { name: "Search" }).click();

  await expect(page.getByText("Христос възкръсна")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  expect(searches).toEqual(["resurrection"]);
  await expect(page.getByText("Searched (English): resurrection")).toBeVisible();
  // Both calls' usage, summed: 50 + 1000.
  await expect(page.locator(".chat-message-usage").last()).toHaveText(/1,?050/);

  // The cited source is a search hit, not the reader's own chapter, and scripture arrives
  // whole — never as a snippet (§3).
  await page.locator("details.chat-sources > summary").last().click();
  const cited = page.locator("li.chat-source").nth(1);
  await expect(cited).toContainText("[S2]");
  await expect(cited).not.toContainText("John 3 (WEB)");
  await expect(cited).not.toContainText("search excerpt");
  const excerpt = (await cited.locator("blockquote").innerText()).trim();
  expect(excerpt).toMatch(/^\d+ /);
  const words = excerpt.replace(/^\d+\s+/, "").split(/\s+/).slice(0, 4).join(" ");

  // The citation opens the target the app actually retrieved: its words are in the reader.
  await page.locator("button.chat-citation").first().click();
  await expect(page.locator(".reader").getByText(words, { exact: false }).first()).toBeVisible();
});

test("Stop during expansion aborts the expansion request, leaves no rows, and returns the question to the composer", async ({
  page,
}) => {
  await openAssistantWithSearch(page);
  await page.unroute(COMPLETIONS);
  await page.route(COMPLETIONS, () => {
    // Never answers: only Stop can end this request.
  });
  await page.getByLabel("Your question").fill(QUESTION);

  // The expansion request leaves the instant Send is clicked — unlike M9.3's turn there is
  // no retrieval before it — so the listener must be armed before the click.
  const issued = page.waitForRequest(COMPLETIONS);
  const failing = page.waitForEvent("requestfailed", (request) => request.url() === COMPLETIONS);
  await page.getByRole("button", { name: "Send" }).click();
  await issued;
  await page.getByRole("button", { name: "Stop" }).click();
  const failed = await failing;
  expect(failed.failure()?.errorText ?? "").toMatch(/abort/i);

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue(QUESTION);
  await expect(messageRows(page)).toHaveCount(0);
  await expect(confirmRegion(page)).not.toBeAttached();
});

test("Stop during the search fan-out aborts every pending search and never reaches the answering call", async ({
  page,
}) => {
  await openAssistantWithSearch(page);
  await page.route(SEARCH, () => {
    // Held open until Stop aborts them.
  });
  let issued = 0;
  let completions = 0;
  const failed: string[] = [];
  page.on("request", (request) => {
    if (SEARCH.test(request.url())) issued++;
    if (request.url() === COMPLETIONS) completions++;
  });
  page.on("requestfailed", (request) => {
    if (SEARCH.test(request.url())) failed.push(request.url());
  });

  await send(page);
  await confirmRegion(page).getByRole("button", { name: "Search" }).click();
  // Both terms' searches are in flight before Stop, so the shared signal has something
  // to reach.
  await expect.poll(() => issued).toBe(TERMS.length);
  await page.getByRole("button", { name: "Stop" }).click();

  await expect.poll(() => failed.length).toBe(TERMS.length);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue(QUESTION);
  await expect(messageRows(page)).toHaveCount(0);
  expect(completions).toBe(1); // the expansion only
});

test("the confirm, empty and error panels have no serious accessibility violations; Escape at confirm keeps the drawer open", async ({
  page,
}) => {
  await openAssistantWithSearch(page);
  // Deselect the open chapter, so a search that matches nothing yields an empty manifest.
  await page.locator(".chat-context-strip > summary").click();
  await page.locator("label.context-chip input[type=checkbox]").first().uncheck();
  await expect(page.locator(".chat-context-strip > summary")).toContainText("nothing selected");

  // Confirm: a labelled region that takes focus itself.
  await send(page);
  await expect(confirmRegion(page)).toBeVisible();
  await expect(confirmRegion(page)).toBeFocused();
  expect(await seriousViolations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-drawer")).toHaveClass(/\bopen\b/);
  await expect(page.getByLabel("Your question")).toHaveValue(QUESTION);
  await expect(page.getByLabel("Your question")).toBeFocused();

  // Empty: the search matched nothing (§7a).
  await page.route(SEARCH, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ query: "q", refine: null, sort: "relevance", total: 0, groups: [] }),
    }),
  );
  await page.getByRole("button", { name: "Send" }).click();
  await confirmRegion(page).getByRole("button", { name: "Search" }).click();
  const empty = page.getByRole("region", { name: "Nothing usable was found" });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText("No content matched");
  await expect(empty).toContainText("Terms tried: resurrection, risen");
  expect(await seriousViolations(page)).toEqual([]);
  await empty.getByRole("button", { name: "Cancel" }).click();

  // Error: the provider rejects the expansion call (§7's error table).
  await page.unroute(COMPLETIONS);
  await page.route(COMPLETIONS, (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: "bad key" } }) }),
  );
  await page.getByRole("button", { name: "Send" }).click();
  const error = page.getByRole("region", { name: "The search step did not complete" });
  await expect(error).toBeVisible();
  await expect(error.getByRole("button", { name: "Open settings" })).toBeVisible();
  await expect(error.getByRole("button", { name: "Retry" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await error.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveValue(QUESTION);
  await expect(messageRows(page)).toHaveCount(0);
});
