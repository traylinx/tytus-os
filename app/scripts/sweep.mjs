// Skeleton sweep — opens every app from the registry, captures runtime errors.
//
// We dispatch clicks directly on app buttons via JS evaluation rather than
// page.click() because the launcher dialog uses backdrop-filter, which creates
// a stacking context Playwright's hit-test treats as opaque on top of children.
// Bypassing hit-test with native .click() is reliable and faster.
//
// Usage: TYTUS_BASE=http://localhost:4242 node scripts/sweep.mjs

import { chromium } from 'playwright';

const BASE = process.env.TYTUS_BASE || 'http://localhost:4242';
const winSel = (id) => `div[data-app-id="${id}"]`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errsByApp = { __shell__: [] };
  let currentApp = '__shell__';
  page.on('pageerror', (e) => errsByApp[currentApp].push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errsByApp[currentApp].push(`console.error: ${msg.text()}`);
  });

  console.log(`navigate ${BASE}`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Log in as Guest', { timeout: 12000 });
  await page.click('text=Log in as Guest');
  await page.waitForSelector('button[aria-label="Open app launcher"]', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Open launcher once and harvest the canonical app list from the All grid
  await page.click('button[aria-label="Show applications"]');
  await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
  await page.waitForTimeout(500);
  // The default tab is 'All' on launcher open — just harvest immediately
  const apps = await page.$$eval('[role="dialog"] [style*="auto-fill"] > button', (cards) =>
    cards.map((c) => ({
      name: c.querySelector('span')?.textContent?.trim() || '',
    })).filter((a) => a.name)
  );
  console.log(`discovered ${apps.length} apps in launcher`);
  // Close launcher
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  let pass = 0;
  let fail = 0;

  for (const { name } of apps) {
    currentApp = name;
    errsByApp[name] = [];
    process.stdout.write(`  ${name.padEnd(22)} `);
    try {
      // Open via launcher: type into search, then trigger button .click() directly
      // (bypasses Playwright hit-test, which is confused by the backdrop-filter
      // stacking context on the dialog).
      await page.click('button[aria-label="Show applications"]');
      await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
      await page.fill('input[placeholder*="search applications"]', name);
      await page.waitForTimeout(300);
      const opened = await page.evaluate((name) => {
        const cards = [...document.querySelectorAll('[role="dialog"] [style*="auto-fill"] > button')];
        const exact = cards.find((c) => (c.querySelector('span')?.textContent || '').trim() === name);
        if (!exact) return false;
        exact.click();
        return true;
      }, name);
      if (!opened) throw new Error(`no card matching "${name}"`);

      await page.waitForSelector('div.absolute.flex.flex-col[data-app-id]', { timeout: 4000 });
      await page.waitForTimeout(200);
      const appId = await page.locator('div.absolute.flex.flex-col[data-app-id]').last().getAttribute('data-app-id');

      // Close (also via direct .click() to skip hit-test)
      await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Close"]');
        if (btn) btn.click();
      });
      await page.waitForTimeout(200);
      await page.waitForSelector(winSel(appId), { state: 'detached', timeout: 2000 }).catch(() => {});

      const errs = errsByApp[name];
      if (errs.length === 0) {
        process.stdout.write(`✓ (${appId})\n`);
        pass++;
      } else {
        process.stdout.write(`✗ ${errs.length} error(s)\n`);
        errs.forEach((e) => console.log(`     ${e}`));
        fail++;
      }
    } catch (e) {
      process.stdout.write(`✗ ${e.message}\n`);
      fail++;
    }
  }

  if (errsByApp.__shell__.length > 0) {
    console.log('\nshell-level errors (pre-app):');
    errsByApp.__shell__.forEach((e) => console.log('  ' + e));
  }

  console.log(`\nsummary: ${pass} pass · ${fail} fail · ${apps.length} total`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SWEEP FAILED:', e.message);
  process.exit(1);
});
