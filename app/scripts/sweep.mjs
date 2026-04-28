// Skeleton sweep — opens every app from the launcher, captures runtime errors.
// Discovers the app catalog by reading the launcher grid (no TS import).
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
  await page.waitForSelector('text=Activities', { timeout: 5000 });
  await page.waitForTimeout(300);

  // Open launcher and harvest the All-tab grid for the canonical app list
  await page.click('button[aria-label="Show applications"]');
  await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
  // Force "All" tab
  await page.locator('button', { hasText: /^All$/ }).first().click();
  await page.waitForTimeout(200);

  const apps = await page.$$eval('div[style*="auto-fill"] > button', (cards) =>
    cards.map((c) => c.querySelector('span')?.textContent?.trim()).filter(Boolean)
  );
  console.log(`discovered ${apps.length} apps in launcher`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const name of apps) {
    currentApp = name;
    errsByApp[name] = [];
    process.stdout.write(`  ${name.padEnd(22)} `);
    try {
      await page.click('button[aria-label="Show applications"]');
      await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
      await page.fill('input[placeholder*="search applications"]', name);
      await page.waitForTimeout(150);
      await page.locator('div[style*="auto-fill"] > button').first().click();
      // Wait for any window-frame to appear (we don't know the appId here)
      await page.waitForSelector('div.absolute.flex.flex-col[data-app-id]', { timeout: 4000 });
      await page.waitForTimeout(150);
      const appId = await page.locator('div.absolute.flex.flex-col[data-app-id]').last().getAttribute('data-app-id');
      // Close it
      await page.click('button[aria-label="Close"]');
      await page.waitForTimeout(150);
      // Wait until window is gone
      await page.waitForSelector(winSel(appId), { state: 'detached', timeout: 2000 }).catch(() => {});
      const errs = errsByApp[name];
      if (errs.length === 0) {
        process.stdout.write(`✓ (${appId})\n`);
        pass++;
      } else {
        process.stdout.write(`✗ ${errs.length} error(s)\n`);
        errs.forEach((e) => console.log(`     ${e}`));
        failures.push({ name, errs });
        fail++;
      }
    } catch (e) {
      process.stdout.write(`✗ ${e.message}\n`);
      failures.push({ name, errs: [e.message] });
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
