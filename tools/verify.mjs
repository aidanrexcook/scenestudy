// End-to-end verification: drives the real app in Chrome with a fake microphone.
// Run: node tools/verify.mjs   (starts its own local server on :8787)
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';

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

  // 1. Create a project — lands directly inside it
  await page.fill('[data-testid="new-project-name"]', 'Pilot Episode');
  await page.click('[data-testid="create-project"]');
  await page.waitForSelector('[data-testid="project-title"]');
  check('create project jumps into it', (await page.textContent('[data-testid="project-title"]')) === 'Pilot Episode');

  // 2. Create a scene — lands directly in its record view
  await page.fill('[data-testid="new-scene-name"]', 'Scene 1');
  await page.click('[data-testid="create-scene"]');
  await page.waitForSelector('[data-testid="scene-title"]');
  check('create scene jumps into record mode', (await page.textContent('[data-testid="scene-title"]')) === 'Scene 1');

  // 3. Record three lines in tap mode
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

  // 11. Save project to a folder — stub the directory picker with the
  // browser's private file system so the real folder-writing code runs.
  await page.evaluate(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await page.click('[data-testid="save-project"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="save-project"]')?.textContent === '✓');
  const saved = await page.evaluate(async () => {
    const files = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`);
        else files.push(`${prefix}${name}:${(await handle.getFile()).size}`);
      }
    }
    await walk(await navigator.storage.getDirectory(), '');
    return files.sort();
  });
  check('save creates project folder with one folder per scene',
    saved.length === 4
      && saved.every((f) => f.startsWith('Callback Tape/Opening Scene/line-'))
      && saved.every((f) => Number(f.split(':')[1]) > 0),
    saved.join(', '));

  // 12. ZIP fallback when the browser has no folder picker
  await page.evaluate(() => { window.showDirectoryPicker = undefined; });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="save-project"]'),
  ]);
  const listing = execSync(`unzip -l "${await download.path()}"`).toString();
  check('zip fallback has same folder layout',
    listing.includes('Callback Tape/Opening Scene/line-01.webm') && listing.includes('line-04.'));

  // 13. Storage persistence (grant depends on browser heuristics — informational)
  console.log(`INFO  storage persisted: ${await page.evaluate(() => navigator.storage.persisted())}`);
} catch (err) {
  failures++;
  console.error('FAIL  unexpected error:', err.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
