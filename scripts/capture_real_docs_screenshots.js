const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const assetsDir = path.join(__dirname, '../docs/user/assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to live app...');
  await page.goto('https://bible.trendafilovi.net/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  // 1. User Interface Overview (default view with 1 or 2 panes)
  console.log('Capturing user_interface_overview.jpg...');
  await page.screenshot({ path: path.join(assetsDir, 'user_interface_overview.jpg'), quality: 90, type: 'jpeg' });

  // 2. Multi Pane Layout (Click '+ Нов панел' or '+ New pane' to open a 2nd/3rd pane)
  console.log('Capturing multi_pane_layout.jpg...');
  const addPaneBtn = page.locator('button:has-text("+"), button:has-text("Панел"), button:has-text("pane")').first();
  if (await addPaneBtn.isVisible()) {
    await addPaneBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(assetsDir, 'multi_pane_layout.jpg'), quality: 90, type: 'jpeg' });

  // 3. Reading Modes Illustration (Click 'Настройки' / Settings)
  console.log('Capturing reading_modes_illustration.jpg...');
  const settingsBtn = page.locator('button:has-text("Настройки"), button:has-text("Settings"), button[title*="Settings"]').first();
  if (await settingsBtn.isVisible()) {
    await settingsBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(assetsDir, 'reading_modes_illustration.jpg'), quality: 90, type: 'jpeg' });

  // Close modal if open
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 4. Search and Lookup Illustration (Click 'Търсене' / Search)
  console.log('Capturing search_and_lookup_illustration.jpg...');
  const searchBtn = page.locator('button:has-text("Търсене"), button:has-text("Search"), button[title*="Search"]').first();
  if (await searchBtn.isVisible()) {
    await searchBtn.click();
    await page.waitForTimeout(500);
    const searchInput = page.locator('input[type="search"], input[type="text"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('light');
      await page.waitForTimeout(1000);
    }
  }
  await page.screenshot({ path: path.join(assetsDir, 'search_and_lookup_illustration.jpg'), quality: 90, type: 'jpeg' });

  // Close search modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 5. Personal Notes Editor (Switch pane source to Notes / Бележки)
  console.log('Capturing personal_notes_editor.jpg...');
  const sourceSelect = page.locator('select[aria-label="Източник"], select[aria-label="Source"]').first();
  if (await sourceSelect.isVisible()) {
    await sourceSelect.selectOption({ label: 'Бележки' }).catch(() => sourceSelect.selectOption({ index: 4 }));
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(assetsDir, 'personal_notes_editor.jpg'), quality: 90, type: 'jpeg' });

  // 6. General Books Reader (Switch pane source to Books / Книги)
  console.log('Capturing general_books_reader.jpg...');
  if (await sourceSelect.isVisible()) {
    await sourceSelect.selectOption({ label: 'Книги' }).catch(() => sourceSelect.selectOption({ index: 3 }));
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(assetsDir, 'general_books_reader.jpg'), quality: 90, type: 'jpeg' });

  // 7. Dropbox Sync Illustration (Open Settings -> Sync tab)
  console.log('Capturing dropbox_sync_illustration.jpg...');
  if (await settingsBtn.isVisible()) {
    await settingsBtn.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(assetsDir, 'dropbox_sync_illustration.jpg'), quality: 90, type: 'jpeg' });

  await browser.close();
  console.log('All real screenshots captured successfully!');
})();
