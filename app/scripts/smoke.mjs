import { chromium } from 'playwright';
import fs from 'fs';

// auto-detect dev port from vite log scrape via env override
const BASE = process.env.TYTUS_BASE || 'http://localhost:4242';

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

  // ===== windows =====
  console.log('5. open Pod Inspector via desktop icon dbl-click');
  await page.locator('span:has-text("Pods")').first().dblclick();
  await page.waitForTimeout(500);
  await page.waitForSelector('h2:has-text("Pod Inspector")', { timeout: 5000 });

  const winLocator = page.locator('div.absolute.flex.flex-col').filter({ has: page.locator('h2:has-text("Pod Inspector")') });
  const initBox = await winLocator.boundingBox();

  console.log('6. drag title bar');
  await page.mouse.move(initBox.x + 100, initBox.y + 18);
  await page.mouse.down();
  await page.mouse.move(initBox.x + 120, initBox.y + 28, { steps: 3 });
  await page.mouse.move(initBox.x + 320, initBox.y + 110, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await winLocator.boundingBox();
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
  const afterResize = await winLocator.boundingBox();
  if (afterResize.width - afterDrag.width < 50) throw new Error(`RESIZE FAIL`);
  console.log(`   ✓ dw=${afterResize.width - afterDrag.width}, dh=${afterResize.height - afterDrag.height}`);

  console.log('8. close (X)');
  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);
  if ((await page.locator('h2:has-text("Pod Inspector")').count()) !== 0) throw new Error('CLOSE FAIL');
  console.log('   ✓ closed');

  // ===== dock =====
  console.log('9. dock-stickiness regression: Chat → close → Files → check Chat is not focused');
  await page.locator('span:has-text("Chat")').first().dblclick();
  await page.waitForTimeout(500);
  await page.waitForSelector('h2:has-text("Chat")', { timeout: 3000 });

  // Wait for bounce to finish (400ms + buffer)
  await page.waitForTimeout(700);

  // Read the dock chat icon's transform — should be no Y translation
  const chatDockBtn = page.locator('button[title="Chat"]').first();
  const chatBoxBefore = await chatDockBtn.boundingBox();
  console.log(`   chat dock icon Y after bounce: ${chatBoxBefore.y}`);

  console.log('10. close Chat window');
  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);

  console.log('11. open Files');
  await page.locator('span:has-text("Files")').first().dblclick();
  await page.waitForTimeout(700); // include bounce

  const chatBoxAfter = await chatDockBtn.boundingBox();
  console.log(`   chat dock icon Y after open Files: ${chatBoxAfter.y}`);

  // The Chat icon should be in its baseline position (not raised by bouncing)
  if (Math.abs(chatBoxAfter.y - chatBoxBefore.y) > 1) {
    throw new Error(`DOCK STICKINESS BUG: chat icon Y drifted from ${chatBoxBefore.y} to ${chatBoxAfter.y}`);
  }
  console.log('   ✓ chat icon settled, no stickiness');

  // Verify chat dock icon has no "open" indicator dot but Files does
  // The dot is a span/div with `rounded-full` `w-1 h-1` inside the chat dock button's parent
  const chatHasDot = await page.locator('button[title="Chat"]').first()
    .locator('xpath=..').locator('div.rounded-full').count();
  console.log(`   chat dot indicator: ${chatHasDot}`);

  const filesHasDot = await page.locator('button[title="Files"]').first()
    .locator('xpath=..').locator('div.rounded-full').count();
  console.log(`   files dot indicator: ${filesHasDot}`);

  if (chatHasDot > 0) throw new Error('Chat dock dot is stuck even after close');
  if (filesHasDot === 0) throw new Error('Files dock dot missing while window open');
  console.log('   ✓ dot indicators correct');

  // ===== misc =====
  console.log('12. minimize active window');
  await page.click('button[aria-label="Minimize"]');
  await page.waitForTimeout(400);
  if ((await page.locator('h2:has-text("Files")').count()) !== 0) throw new Error('MINIMIZE FAIL');
  console.log('   ✓ minimize hides window');

  console.log('13. click Files in dock to restore minimized window');
  await page.locator('button[title="Files"]').first().click();
  await page.waitForTimeout(400);
  if ((await page.locator('h2:has-text("Files")').count()) === 0) throw new Error('RESTORE FROM DOCK FAIL');
  console.log('   ✓ restored from dock');

  console.log('14. maximize');
  await page.click('button[aria-label="Maximize"]');
  await page.waitForTimeout(400);
  const filesWin = page.locator('div.absolute.flex.flex-col').filter({ has: page.locator('h2:has-text("Files")') });
  const maxBox = await filesWin.boundingBox();
  if (maxBox.width < 1300 || maxBox.height < 700) throw new Error(`MAXIMIZE FAIL: ${JSON.stringify(maxBox)}`);
  console.log(`   ✓ maximized to ${maxBox.width}x${maxBox.height}`);

  // ===== app launcher =====
  console.log('15. close + open app launcher (Meta key)');
  await page.click('button[aria-label="Close"]');
  await page.waitForTimeout(400);
  // Use the dock LayoutGrid button — Meta key is OS-intercepted in headless
  await page.click('button[aria-label="Show applications"]');
  await page.waitForTimeout(400);
  await page.waitForSelector('input[placeholder*="search applications"]', { timeout: 3000 });
  console.log('   ✓ launcher open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const launcherStillOpen = await page.locator('input[placeholder*="search applications"]').count();
  if (launcherStillOpen) throw new Error('LAUNCHER ESC FAIL');
  console.log('   ✓ Esc closes launcher');

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
