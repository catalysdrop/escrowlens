// EscrowLens demo-video screenshots (localhost dashboard + HTML slides).
// Uses playwright-core from the Aevum video folder via NODE_PATH.
// No proxy needed: everything is localhost or file://.
const { chromium } = require('playwright-core');
const path = require('path');

const BASE = '/home/hatch/workspace/goals/terminal-3-micro-grant/escrowlens/demo-video';
const SHOTS = path.join(BASE, 'shots');
const DEMO_AGENT = '0xc2C2325a8E46b4ab6AdF6131757B04ecE0c62663';
const GHOST_AGENT = '0x3cb5d9c8da9f936a2fd042464f858b4f8910bc47';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // 1. Title slide
  await page.goto('file://' + path.join(BASE, 'slides/slide-title.html'));
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/01-title.png` });
  console.log('01-title done');

  // 2. Dashboard — leaderboard in view
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('.leader-row').first().waitFor({ timeout: 30000 });
  await page.locator('#board').scrollIntoViewIfNeeded();
  await sleep(1200);
  await page.screenshot({ path: `${SHOTS}/02-dashboard.png` });
  console.log('02-dashboard done');

  // 3. Demo agent trust card
  await page.locator('#addr').fill(DEMO_AGENT);
  await page.locator('#check').click();
  await page.locator('.score').waitFor({ timeout: 30000 });
  await sleep(800);
  await page.locator('#result').scrollIntoViewIfNeeded();
  await sleep(800);
  await page.screenshot({ path: `${SHOTS}/03-demo-agent.png` });
  console.log('03-demo-agent done');

  // 4. Ghost agent trust card
  await page.locator('#addr').fill(GHOST_AGENT);
  await page.locator('#check').click();
  await page.locator('.score').waitFor({ timeout: 30000 });
  await sleep(800);
  await page.locator('#result').scrollIntoViewIfNeeded();
  await sleep(800);
  await page.screenshot({ path: `${SHOTS}/04-ghost-agent.png` });
  console.log('04-ghost-agent done');

  // 5. TEE slide
  await page.goto('file://' + path.join(BASE, 'slides/slide-tee.html'));
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/05-tee.png` });
  console.log('05-tee done');

  // 6. Closing slide
  await page.goto('file://' + path.join(BASE, 'slides/slide-closing.html'));
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/06-closing.png` });
  console.log('06-closing done');

  await browser.close();
  console.log('ALL SHOTS DONE');
})().catch((e) => {
  console.error('SHOT FAILED:', e.message);
  process.exit(1);
});
