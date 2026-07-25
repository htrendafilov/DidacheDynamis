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
  const query = page.getByRole("searchbox", { name: "Search query" });
  await query.fill("earth");
  await query.press("Enter");
  await expect(page.getByRole("tab", { name: /All/ })).toBeVisible();

  const allTab = page.getByRole("tab", { name: /All/ });
  await allTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /Bible/ })).toBeFocused();

  const separator = page.getByRole("separator", { name: "Resize search" });
  const initialWidth = await separator.getAttribute("aria-valuenow");
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(separator).not.toHaveAttribute("aria-valuenow", initialWidth ?? "");
  expect(await seriousViolations(page)).toEqual([]);
});

test("mobile populated search and filter dialog have no serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const query = page.getByRole("searchbox", { name: "Search query" });
  await query.fill("earth");
  await query.press("Enter");
  await page.getByRole("button", { name: /Filters/ }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("mobile book reader and contents overlay have no serious accessibility violations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Source" }).selectOption("book");
  await expect(page.getByRole("navigation", { name: "Table of contents" })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
});

test("mobile tab switcher changes the visible pane by click and keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();

  // second pane -> a tablist appears; only the active pane is mounted
  await page.getByRole("button", { name: /Add pane/ }).click();
  const tablist = page.getByRole("tablist", { name: /Switch pane/i });
  await expect(tablist).toBeVisible();
  await expect(page.locator(".pane-wrap")).toHaveCount(1);
  const tabs = tablist.getByRole("tab");
  await expect(tabs).toHaveCount(2);
  // the panel is associated with the tabs (aria-controls)
  await expect(tabs.first()).toHaveAttribute("aria-controls", "mobile-pane-panel");

  // click the 2nd tab -> selection moves, and make it visibly different (Notes)
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  await page.locator(".pane-wrap").locator("select").first().selectOption("notes");
  await expect(page.getByText("God so loved the world")).toHaveCount(0);

  // A horizontal tablist must not consume vertical arrows: they remain available for scrolling.
  await tabs.nth(1).focus();
  await page.keyboard.press("ArrowDown");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

  // ArrowLeft from the 2nd tab selects the 1st, and the Bible pane returns.
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("God so loved the world")).toBeVisible();

  expect(await seriousViolations(page)).toEqual([]);
});
