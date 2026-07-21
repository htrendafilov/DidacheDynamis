import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const SEED = {
  state: {
    panes: [{ id: "p1", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    settings: {
      verseLayout: "per-line",
      wordsOfChrist: "red",
      theme: "light",
      fontScale: 1,
      uiLang: "en",
      sync: true,
    },
  },
  version: 0,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
});

async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
}

test("reader view has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("settings + search panels have no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  expect(await seriousViolations(page)).toEqual([]);
  await page.getByRole("button", { name: "Search" }).click();
  expect(await seriousViolations(page)).toEqual([]);
});

test("mobile shows one pane with a working tab switcher", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
  // add a notes pane; on mobile a tablist appears and only the active pane shows
  await page.getByRole("button", { name: /Add pane/ }).click();
  await page.locator(".pane-wrap").last().locator("select").first().selectOption("notes");
  const tabs = page.getByRole("tablist", { name: /Switch pane/i });
  await expect(tabs).toBeVisible();
  // only one pane is mounted at a time
  await expect(page.locator(".pane-wrap")).toHaveCount(1);
  expect(await seriousViolations(page)).toEqual([]);
});
