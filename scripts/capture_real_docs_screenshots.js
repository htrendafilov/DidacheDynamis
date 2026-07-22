const path = require("path");

const { chromium } = require("../apps/web/node_modules/playwright");

const LIVE_URL = "https://bible.trendafilovi.net/";
const ASSETS_DIR = path.join(__dirname, "../docs/user/assets");
const SEED = {
  state: {
    panes: [{ id: "docs-pane", type: "bible", workId: "web", osis: "John", chapter: 3 }],
    settings: {
      verseLayout: "per-line",
      wordsOfChrist: "red",
      theme: "light",
      fontScale: 1,
      uiLang: "en",
      sync: true,
      bookMode: "paged",
    },
  },
  version: 0,
};

async function freshPage(context) {
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    localStorage.setItem("bible-app", JSON.stringify(seed));
  }, SEED);
  await page.goto(LIVE_URL, { waitUntil: "networkidle" });
  await page.getByText("God so loved the world").waitFor();
  return page;
}

async function capture(page, filename) {
  await page.screenshot({
    path: path.join(ASSETS_DIR, filename),
    quality: 90,
    type: "jpeg",
  });
  await page.close();
}

async function captureElement(page, locator, filename) {
  await locator.screenshot({
    path: path.join(ASSETS_DIR, filename),
    quality: 90,
    type: "jpeg",
  });
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

  let page = await freshPage(context);
  await capture(page, "user_interface_overview.jpg");

  page = await freshPage(context);
  await page.getByRole("button", { name: /Add pane/ }).click();
  await page.locator(".pane-wrap").nth(1).waitFor();
  await page.waitForTimeout(750);
  await capture(page, "multi_pane_layout.jpg");

  page = await freshPage(context);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor();
  await capture(page, "reading_modes_illustration.jpg");

  page = await freshPage(context);
  await page.getByRole("button", { name: "Search" }).click();
  const search = page.getByPlaceholder("Search the text…");
  await search.fill("light");
  await search.press("Enter");
  await page.locator(".search-results .result").first().waitFor();
  await capture(page, "search_and_lookup_illustration.jpg");

  page = await freshPage(context);
  await page.getByRole("combobox", { name: "Source" }).selectOption("notes");
  page.once("dialog", (dialog) => dialog.accept("Study note"));
  await page.getByRole("button", { name: /New topic/ }).click();
  const editor = page.locator(".rte-content");
  await editor.waitFor();
  await editor.fill("Personal study notes remain in this browser unless Dropbox sync is enabled.");
  await capture(page, "personal_notes_editor.jpg");

  page = await freshPage(context);
  await page.getByRole("combobox", { name: "Source" }).selectOption("book");
  await page.locator(".book-page").waitFor();
  await capture(page, "general_books_reader.jpg");

  page = await freshPage(context);
  await page.getByRole("button", { name: "Settings" }).click();
  const dropboxSettings = page.locator(".dropbox-settings");
  await dropboxSettings.waitFor();
  await captureElement(page, dropboxSettings, "dropbox_sync_illustration.jpg");

  await context.close();
  await browser.close();
  console.log("Captured seven isolated live-app documentation screenshots.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
