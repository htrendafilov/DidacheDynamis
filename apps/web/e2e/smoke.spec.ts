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
      bookMode: "paged",
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

test("search filters by an individual Bible book and exposes a removable chip", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const input = page.getByPlaceholder("Search the text…");
  await input.fill("earth");
  await input.press("Enter");
  await expect(page.getByRole("tab", { name: /Bible/ })).toBeVisible();

  await page.getByText("Bible books", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Genesis" }).check();
  const chip = page.getByRole("button", { name: "Remove filter Genesis" });
  await expect(chip).toBeVisible();
  await expect(page.locator(".search-results").getByText(/Genesis 1:/).first()).toBeVisible();

  await chip.click();
  await expect(chip).not.toBeVisible();
});

test("mobile search presents filters in a bottom sheet", async ({ page }) => {
  await page.setViewportSize({ width: 680, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const input = page.getByPlaceholder("Search the text…");
  await input.fill("earth");
  await input.press("Enter");

  await page.getByRole("button", { name: /^☷ Filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "New Testament" }).click();
  await expect(
    page.getByRole("button", { name: "Remove filter New Testament" }),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Close filters" }).click();
  await expect(sheet).not.toBeVisible();
});

test("a cross-reference opens its destination in the same Bible pane", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("God so loved the world")).toBeVisible();
  await page.locator(".reader").getByRole("button", { name: "Verse 16", exact: true }).click();
  const tools = page.locator(".verse-tools");
  await expect(tools).toBeVisible();
  await expect(tools.getByText("Cross-references")).toBeVisible();
  await tools.getByRole("button", { name: /Romans 5:8/ }).click();

  const pane = page.locator(".bible-pane");
  await expect(pane.getByRole("combobox", { name: "Bible version" })).toHaveValue("web");
  await expect(pane.getByRole("combobox", { name: "Book" })).toHaveValue("Rom");
  await expect(pane.getByRole("combobox", { name: "Chapter" })).toHaveValue("5");
  await expect(pane.getByText(/But God commends his own love toward us/i)).toBeVisible();
});

test("opens a validated Bible deep link", async ({ page }) => {
  await page.goto("/#/b/web/Matt/2");
  const pane = page.locator(".bible-pane");
  await expect(pane.getByRole("combobox", { name: "Bible version" })).toHaveValue("web");
  await expect(pane.getByRole("combobox", { name: "Book" })).toHaveValue("Matt");
  await expect(pane.getByRole("combobox", { name: "Chapter" })).toHaveValue("2");
  await expect(pane.getByText(/Jesus was born in Bethlehem/i)).toBeVisible();
});

test("rejects a Bible deep link to a missing chapter", async ({ page }) => {
  await page.goto("/#/b/web/John/999");
  await expect(page.getByRole("alert")).toContainText(
    "This Bible link does not point to an available book and chapter.",
  );
  await expect(page).toHaveURL(/\/$/);
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
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("group", { name: "Book view" })
    .getByRole("button", { name: "Scrolling" })
    .click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.locator(".book-scroll-section")).toHaveCount(35);
  await toc.getByRole("button", { name: /Chapter 1 — Of the Holy Scriptures/i }).click();
  await expect(page.getByText(/The Holy Scripture is the only sufficient/i)).toBeVisible();
});

test("mobile book contents closes after choosing a section", async ({ page }) => {
  // Exercises the former 641–720px dead zone as well as the single-pane breakpoint.
  await page.setViewportSize({ width: 680, height: 844 });
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
