import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.TYTUS_BASE || 'http://localhost:4242';

const win = (appId) => `div[data-app-id="${appId}"]`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  console.log('1. navigate', BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  console.log('2. wait for login (boot ~4s)');
  await page.waitForSelector('text=Log in as Guest', { timeout: 12000 });

  console.log('3. login as guest');
  await page.click('text=Log in as Guest');

  console.log('4. wait for desktop');
  await page.waitForSelector('text=Activities', { timeout: 5000 });
  await page.waitForTimeout(300);

  console.log('5. open Pod Inspector via desktop dbl-click');
  await page.locator('span:has-text("Pods")').first().dblclick();
  await page.waitForSelector(win('pod-inspector'), { timeout: 5000 });
  const initBox = await page.locator(win('pod-inspector')).boundingBox();

  console.log('6. drag title bar');
  await page.mouse.move(initBox.x + 100, initBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(initBox.x + 120, initBox.y + 28, { steps: 3 });
  await page.mouse.move(initBox.x + 320, initBox.y + 110, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await page.locator(win('pod-inspector')).boundingBox();
  if (afterDrag.x - initBox.x < 100) throw new Error(`DRAG FAIL: dx=${afterDrag.x - initBox.x}`);
  console.log(`   ✓ dx=${afterDrag.x - initBox.x}, dy=${afterDrag.y - initBox.y}`);

  console.log('7. resize SE corner');
  const seX = afterDrag.x + afterDrag.width - 4;
  const seY = afterDrag.y + afterDrag.height - 4;
  await page.mouse.move(seX, seY);
  await page.mouse.down();
  await page.mouse.move(seX + 20, seY + 20, { steps: 3 });
  await page.mouse.move(seX + 120, seY + 100, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterResize = await page.locator(win('pod-inspector')).boundingBox();
  if (afterResize.width - afterDrag.width < 50) throw new Error(`RESIZE FAIL`);
  console.log(`   ✓ dw=${afterResize.width - afterDrag.width}, dh=${afterResize.height - afterDrag.height}`);

  console.log('8. close (X)');
  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);
  if ((await page.locator(win('pod-inspector')).count()) !== 0) throw new Error('CLOSE FAIL');
  console.log('   ✓ closed');

  console.log('9. dock-stickiness regression: Chat → close → Files');
  await page.locator('span:has-text("Chat")').first().dblclick();
  await page.waitForSelector(win('chat'), { timeout: 5000 });
  await page.waitForTimeout(700);

  const chatDockBtn = page.locator('button[title="Chat"]').first();
  const chatBoxBefore = await chatDockBtn.boundingBox();
  console.log(`   chat dock Y after bounce: ${chatBoxBefore.y}`);

  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);

  await page.locator('span:has-text("Files")').first().dblclick();
  await page.waitForSelector(win('filemanager'), { timeout: 5000 });
  await page.waitForTimeout(700);

  const chatBoxAfter = await chatDockBtn.boundingBox();
  console.log(`   chat dock Y after open Files: ${chatBoxAfter.y}`);
  if (Math.abs(chatBoxAfter.y - chatBoxBefore.y) > 1) {
    throw new Error(`DOCK STICKINESS BUG: chat icon Y drifted from ${chatBoxBefore.y} to ${chatBoxAfter.y}`);
  }
  console.log('   ✓ chat icon settled');

  const chatHasDot = await chatDockBtn.locator('xpath=..').locator('div.rounded-full').count();
  const filesHasDot = await page.locator('button[title="Files"]').first()
    .locator('xpath=..').locator('div.rounded-full').count();
  console.log(`   chat dot: ${chatHasDot} · files dot: ${filesHasDot}`);
  if (chatHasDot > 0) throw new Error('Chat dot stuck after close');
  if (filesHasDot === 0) throw new Error('Files dot missing while open');

  console.log('10. minimize Files');
  await page.click('button[aria-label="Minimize"]');
  await page.waitForTimeout(400);
  if ((await page.locator(win('filemanager')).count()) !== 0) throw new Error('MINIMIZE FAIL');
  console.log('   ✓ minimized');

  console.log('11. restore via dock click');
  await page.locator('button[title="Files"]').first().click();
  await page.waitForTimeout(400);
  if ((await page.locator(win('filemanager')).count()) === 0) throw new Error('RESTORE FAIL');
  console.log('   ✓ restored');

  console.log('12. maximize');
  await page.click('button[aria-label="Maximize"]');
  await page.waitForTimeout(400);
  const maxBox = await page.locator(win('filemanager')).boundingBox();
  if (maxBox.width < 1300 || maxBox.height < 700) throw new Error(`MAXIMIZE FAIL`);
  console.log(`   ✓ maximized to ${maxBox.width}x${maxBox.height}`);

  console.log('13. app launcher open + Esc');
  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);
  await page.click('button[aria-label="Show applications"]');
  await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
  console.log('   ✓ launcher open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if ((await page.locator('input[placeholder*="search applications"]').count()) > 0)
    throw new Error('LAUNCHER ESC FAIL');
  console.log('   ✓ Esc closes launcher');

  console.log('14. open restored apps: Settings, Calculator, Notes');
  for (const id of ['settings', 'calculator', 'notes']) {
    await page.click('button[aria-label="Show applications"]');
    await page.waitForTimeout(300);
    // Apps in launcher use button with text+icon; search lets us filter precisely
    await page.fill('input[placeholder*="search applications"]', id);
    await page.waitForTimeout(300);
    // First button in the grid after typing matches our app
    await page.locator('div[style*="auto-fill"] > button').first().click();
    await page.waitForSelector(win(id), { timeout: 5000 });
    console.log(`   ✓ ${id} opens`);
    await page.click('button[aria-label="Close"]');
    await page.waitForTimeout(300);
  }

  await page.screenshot({ path: '/tmp/tytus-final.png' });

  if (errors.length > 0) {
    console.log('\n⚠️  CONSOLE/PAGE ERRORS:');
    [...new Set(errors)].forEach((e) => console.log('   ' + e));
    fs.writeFileSync('/tmp/tytus-errors.txt', errors.join('\n'));
    throw new Error(`${errors.length} console errors detected`);
  }

  console.log('\n✅ ALL CHECKS PASS — zero console errors');
  await browser.close();
}

main().catch(async (e) => {
  console.error('\n❌ TEST FAILED:', e.message);
  process.exit(1);
});
