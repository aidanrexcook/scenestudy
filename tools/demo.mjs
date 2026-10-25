// Drives the app with a fake mic and captures screenshots of each screen.
// Run: node tools/demo.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('../.context/', import.meta.url).pathname;

const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto(BASE);

  // Build demo data: one project, one scene, three recorded lines.
  await page.fill('[data-testid="new-project-name"]', 'Callback — Detective Show');
  await page.click('[data-testid="create-project"]');
  await page.waitForSelector('[data-testid="project-card"]');
  await page.click('.card-title');
  await page.fill('[data-testid="new-scene-name"]', 'Interrogation Scene');
  await page.click('[data-testid="create-scene"]');
  await page.waitForSelector('[data-testid="scene-card"]');
  await page.click('[data-testid="scene-card"] .card-title');
  await page.waitForFunction(() => document.querySelector('[data-testid="record-status"]')?.textContent.includes('Ready —'));

  for (const ms of [1400, 2100, 1000]) {
    await page.click('[data-testid="record-btn"]');
    await page.waitForTimeout(ms);
    await page.click('[data-testid="record-btn"]');
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="line-row"]').length === 3);
  await page.screenshot({ path: `${OUT}record-mode.png` });

  // Play mode: capture mid-playback of line 2.
  await page.click('[data-testid="tab-play"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent.includes('line 1 of 3'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent.includes('Press to play line 2'));
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent.includes('Playing line 2'));
  await page.screenshot({ path: `${OUT}play-mode.png` });

  // Projects screen with the project in place.
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-testid="project-card"]');
  await page.screenshot({ path: `${OUT}projects.png` });

  console.log('Screenshots saved to .context/');
} finally {
  await browser.close();
  server.kill();
}
