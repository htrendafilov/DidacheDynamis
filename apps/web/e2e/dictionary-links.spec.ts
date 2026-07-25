import { expect, type Page, test } from "@playwright/test";

// Structured references in Easton's Bible Dictionary: scripture pop-ups (incl. chapter-only)
// and internal dictionary links navigating in the same pane.

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
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
});

async function openAaronEntry(page: Page) {
  await page.goto("/");
  // Keep the seeded Bible pane open (the pop-up's "Open in Bible pane" needs it) and put
  // the dictionary in a second pane.
  await page.getByRole("button", { name: /Add pane/ }).click();
  const wrap = page.locator(".pane-wrap").last();
  await wrap.getByRole("combobox", { name: "Source" }).selectOption("dictionary");
  const pane = wrap.locator(".dictionary-pane");
  await pane.getByPlaceholder(/Find a word/).fill("aar");
  await pane.getByRole("button", { name: "Aaron", exact: true }).click();
  await expect(pane.getByRole("heading", { name: "Aaron" })).toBeVisible();
  return pane;
}

test("a Bible citation in a dictionary entry opens the passage pop-up", async ({ page }) => {
  const pane = await openAaronEntry(page);

  await pane.getByRole("button", { name: "Ex. 6:20" }).first().hover();
  const popover = pane.locator(".scripture-ref-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Exodus 6:20");
  await expect(popover).toContainText(/Jochebed/i);

  await popover.getByRole("button", { name: "Open in Bible pane" }).click();
  const biblePane = page.locator(".bible-pane");
  await expect(biblePane.getByRole("combobox", { name: "Book" })).toHaveValue("Exod");
  await expect(biblePane.getByRole("combobox", { name: "Chapter" })).toHaveValue("6");
});

test("a chapter-only citation previews the chapter without pretending verse 1", async ({
  page,
}) => {
  const pane = await openAaronEntry(page);

  await pane.getByRole("button", { name: "Num. 12" }).first().hover();
  const popover = pane.locator(".scripture-ref-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("Numbers 12");
  await expect(popover).not.toContainText("Numbers 12:1");
});

test("a preview near the pane corner stays fully visible", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 480 });
  const pane = await openAaronEntry(page);
  const body = pane.locator(".dictionary-entry");
  const citation = pane.getByRole("button", { name: "Ex. 6:20" }).first();

  // Recreate the edge case deterministically: move a real citation to the visible reading area's
  // bottom-right corner, where the popover must shift left and flip above.
  await citation.evaluate((element) => {
    const bounds = element.closest(".pane-body")?.getBoundingClientRect();
    const trigger = element.getBoundingClientRect();
    if (!bounds) throw new Error("dictionary pane body is missing");
    (element as HTMLElement).style.display = "inline-block";
    (element as HTMLElement).style.transform = `translate(${
      bounds.right - trigger.right - 10
    }px, ${bounds.bottom - trigger.bottom - 10}px)`;
  });
  await citation.hover();

  const popover = pane.locator(".scripture-ref-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toHaveAttribute("data-placement", "above");
  const [popoverBox, bodyBox] = await Promise.all([
    popover.boundingBox(),
    body.boundingBox(),
  ]);
  expect(popoverBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  if (!popoverBox || !bodyBox) return;
  expect(popoverBox.width).toBeLessThanOrEqual(353);
  expect(popoverBox.x).toBeGreaterThanOrEqual(bodyBox.x + 7);
  expect(popoverBox.y).toBeGreaterThanOrEqual(bodyBox.y + 7);
  expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(
    bodyBox.x + bodyBox.width - 7,
  );
  expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(
    bodyBox.y + bodyBox.height - 7,
  );
});

test("an internal MOSES link opens the Moses entry in the same pane", async ({ page }) => {
  const pane = await openAaronEntry(page);

  await pane.getByRole("button", { name: "Open dictionary entry Moses" }).first().click();
  await expect(pane.getByRole("heading", { name: "Moses" })).toBeVisible();
  await expect(pane.getByText(/Saved from the water/i).first()).toBeVisible();
});
