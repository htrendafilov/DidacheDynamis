import { expect, type Page, test } from "@playwright/test";

// Force a deterministic start: English UI + one WEB/John 3 Bible pane. addInitScript runs
// on every navigation (including reload), so panes reset to this on reload while notes
// (IndexedDB) persist independently.
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
    },
  },
  version: 0,
};

test.beforeEach(async ({ page }) => {
  // Each Playwright test gets a fresh context (empty IndexedDB), so we only seed the
  // pane/settings state. This runs on every navigation, incl. reload — panes reset to the
  // seed while notes (IndexedDB) persist, which the persistence test relies on.
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
});

async function addNotesPane(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Add pane/ }).click();
  const lastPane = page.locator(".pane-wrap").last();
  await lastPane.locator("select").first().selectOption("notes");
}

test("reads the default passage (full stack renders WEB text)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
});

test("toggles words-of-Christ (red) and verse layout (flowing)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("group", { name: "Words of Christ" })
    .getByRole("button", { name: "Red" })
    .click();
  await expect(page.locator(".reader[data-woc='red']").first()).toBeVisible();
  await expect(page.locator(".reader .woj").first()).toBeVisible();
  await page
    .getByRole("group", { name: "Verse layout" })
    .getByRole("button", { name: "Continuous" })
    .click();
  await expect(page.locator(".reader[data-layout='flowing']").first()).toBeVisible();
});

test("search finds a verse and opens it in the reader", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const input = page.getByPlaceholder("Search the text…");
  await input.fill("shepherd");
  await input.press("Enter");
  const firstResult = page.locator(".search-results .result").first();
  await expect(firstResult).toBeVisible();
  await firstResult.click();
  await expect(page.locator(".reader").getByText(/shepherd/i).first()).toBeVisible();
});

test("a verse number opens the cross-reference popover", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
  await page.locator(".reader").getByRole("button", { name: "Verse 16", exact: true }).click();
  await expect(page.locator(".verse-tools")).toBeVisible();
  await expect(page.locator(".verse-tools").getByText("Cross-references")).toBeVisible();
});

test("opens the 1689 Confession through the General Books pane", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Source" }).selectOption("book");
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();
  await page.getByRole("button", { name: /Hide contents/ }).click();
  await expect(toc).toBeHidden();
  await page.getByRole("button", { name: /Show contents/ }).click();
  await expect(toc).toBeVisible();
  await page
    .getByRole("group", { name: "Reading mode" })
    .getByRole("button", { name: "Scroll" })
    .click();
  await expect(page.locator(".book-scroll-section")).toHaveCount(35);
  await toc.getByRole("button", { name: /Chapter 1 — Of the Holy Scriptures/i }).click();
  await expect(page.getByText(/The Holy Scripture is the only sufficient/i)).toBeVisible();
});

test("mobile book contents closes after choosing a section", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Source" }).selectOption("book");
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();
  await toc.getByRole("button", { name: /Chapter 1 — Of the Holy Scriptures/i }).click();
  await expect(toc).toBeHidden();
  await expect(page.getByText(/The Holy Scripture is the only sufficient/i)).toBeVisible();
});

test("creates a local note that survives a reload", async ({ page }) => {
  await page.goto("/");
  await addNotesPane(page);

  page.once("dialog", (dialog) => dialog.accept("Smoke note"));
  await page.getByRole("button", { name: /New topic/ }).click();
  await expect(page.getByRole("button", { name: "Smoke note" })).toBeVisible();

  const editor = page.locator(".rte-content").first();
  await editor.click();
  await editor.pressSequentially("Hello from the smoke test.");
  await expect(editor).toContainText("Hello from the smoke test.");

  // Reload: panes reset (seed), but the note persists in IndexedDB. Re-open notes and check.
  await page.reload();
  await addNotesPane(page);
  await expect(page.getByRole("button", { name: "Smoke note" })).toBeVisible();
});
