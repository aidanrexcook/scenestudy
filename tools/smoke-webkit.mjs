// Safari-engine (WebKit) smoke test: the app must load, navigate, persist,
// and degrade gracefully without a microphone. Recording itself is exercised
// in verify.mjs on Chrome; WebKit headless has no capture devices.
// Run: node tools/smoke-webkit.mjs [base-url]
import { webkit } from 'playwright-core';
import { spawn } from 'node:child_process';

const external = process.argv[2];
const PORT = 8790;
const BASE = external || `http://localhost:${PORT}`;
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

const server = external ? null
  : spawn('python3', ['tools/serve.py', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
if (server) await new Promise((r) => setTimeout(r, 800));

const browser = await webkit.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);

  await page.waitForSelector('[data-testid="new-project-name"]');
  check('app loads in WebKit', true);

  await page.click('[data-testid="create-project"]'); // auto-named
  await page.waitForSelector('[data-testid="project-title"]');
  check('create project works', (await page.textContent('[data-testid="project-title"]')).startsWith('Project'));

  await page.fill('[data-testid="new-scene-name"]', 'Safari Scene');
  await page.click('[data-testid="create-scene"]');
  await page.waitForSelector('[data-testid="record-status"]');
  // Headless WebKit has no mic: the app must say so rather than break.
  await page.waitForFunction(() =>
    /Ready —|Microphone unavailable|Requesting microphone/.test(document.querySelector('[data-testid="record-status"]')?.textContent || ''));
  check('record view degrades gracefully without a mic', true,
    await page.textContent('[data-testid="record-status"]'));

  await page.click('[data-testid="tab-play"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="play-status"]')?.textContent.includes('No lines recorded yet'));
  check('play view renders', true);
  await page.click('[data-testid="playmode-hold"]');
  check('play mode toggle works', await page.evaluate(() => localStorage.getItem('scenestudy.playMode') === 'hold'));

  await page.reload();
  await page.waitForSelector('[data-testid="play-status"]');
  await page.goto(`${BASE}${external ? '' : ''}/#/`.replace('//#', '/#'));
  await page.waitForSelector('[data-testid="project-card"]');
  check('data persists in WebKit (IndexedDB)', (await page.locator('[data-testid="project-card"]').count()) === 1);

  check('no JavaScript errors anywhere', errors.length === 0, errors.join('; '));
} catch (err) {
  failures++;
  console.error('FAIL  unexpected error:', err.message);
} finally {
  await browser.close();
  server?.kill();
}
console.log(failures === 0 ? '\nWebKit smoke test passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
