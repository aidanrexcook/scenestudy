// End-to-end verification: drives the real app in Chrome with a fake microphone.
// Run: node tools/verify.mjs   (starts its own local server on :8787)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const PORT = 8787;
const BASE = `http://localhost:${PORT}`;
let failures = 0;

function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
}

async function waitForStatus(page, testid, expected, timeout = 8000) {
  try {
    await page.waitForFunction(
      ([tid, text]) => document.querySelector(`[data-testid="${tid}"]`)?.textContent.includes(text),
      [testid, expected], { timeout },
    );
    return true;
  } catch {
    const actual = await page.locator(`[data-testid="${testid}"]`).textContent().catch(() => '(missing)');
    console.log(`       expected "${expected}", saw "${actual}"`);
    return false;
  }
}

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
  const page = await browser.newPage();
  await page.goto(BASE);

  // 1. Create a project
  await page.fill('[data-testid="new-project-name"]', 'Pilot Episode');
  await page.click('[data-testid="create-project"]');
  await page.waitForSelector('[data-testid="project-card"]');
  check('create project', await page.locator('[data-testid="project-card"]').count() === 1);

  // 2. Create a scene
  await page.click('.card-title');
  await page.fill('[data-testid="new-scene-name"]', 'Scene 1');
  await page.click('[data-testid="create-scene"]');
  await page.waitForSelector('[data-testid="scene-card"]');
  check('create scene', await page.locator('[data-testid="scene-card"]').count() === 1);

  // 3. Record three lines in tap mode
  await page.click('[data-testid="scene-card"] .card-title');
  check('mic ready', await waitForStatus(page, 'record-status', 'Ready —'));
  await page.click('[data-testid="mode-tap"]');
  for (let i = 1; i <= 3; i++) {
    await page.click('[data-testid="record-btn"]');
    check(`recording line ${i} started`, await waitForStatus(page, 'record-status', `Recording line ${i}`));
    await page.waitForTimeout(900);
    await page.click('[data-testid="record-btn"]');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="line-row"]').length === n, i);
    check(`line ${i} saved (tap mode)`, true);
  }

  // 4. Record line 4 in hold mode
  await page.click('[data-testid="mode-hold"]');
  const btn = await page.locator('[data-testid="record-btn"]').boundingBox();
  await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="line-row"]').length === 4);
  check('line 4 saved (hold mode)', true);

  // 5. Rename the scene inline
  await page.click('header [title="Rename scene"]');
  await page.fill('.rename-input', 'Opening Scene');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="scene-title"]');
  check('rename scene', (await page.textContent('[data-testid="scene-title"]')) === 'Opening Scene');

  // 6. Play mode: space advances one line at a time, each plays to the end
  await page.click('[data-testid="tab-play"]');
  check('play ready', await waitForStatus(page, 'play-status', 'Press to play line 1 of 4'));
  await page.keyboard.press('Space');
  check('line 1 plays', await waitForStatus(page, 'play-status', 'Playing line 1 of 4'));
  check('line 1 finishes, line 2 queued', await waitForStatus(page, 'play-status', 'Press to play line 2 of 4'));
  await page.keyboard.press('Space');
  check('line 2 plays', await waitForStatus(page, 'play-status', 'Playing line 2 of 4'));

  // 7. Hold resets to line 1, paused
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  check('hold resets to line 1', await waitForStatus(page, 'play-status', 'Press to play line 1 of 4'));

  // 8. Play all the way through
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('Space');
    const after = i < 4 ? `Press to play line ${i + 1} of 4` : 'End of scene — hold to reset';
    check(`sequence step ${i}`, await waitForStatus(page, 'play-status', after));
  }

  // 9. Persistence across reload
  await page.reload();
  check('lines persist after reload', await waitForStatus(page, 'play-status', 'Press to play line 1 of 4'));

  // 10. Rename the project from the projects list
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-testid="project-card"]');
  await page.click('[title="Rename project"]');
  await page.fill('.rename-input', 'Callback Tape');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.card-title')?.textContent === 'Callback Tape');
  check('rename project', true);
} catch (err) {
  failures++;
  console.error('FAIL  unexpected error:', err.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
