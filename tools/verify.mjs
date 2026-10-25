// End-to-end verification: drives the real app in Chrome with a fake microphone.
// Run: node tools/verify.mjs   (starts its own local server on :8787)
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

  // 11. Save project as a ZIP download
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="save-project"]'),
  ]);
  const zipPath = await download.path();
  const listing = execSync(`unzip -l "${zipPath}"`).toString();
  check('zip has manifest and one folder per scene',
    listing.includes('manifest.json')
      && listing.includes('Callback Tape/Opening Scene/line-01.webm')
      && listing.includes('line-04.'));

  // 12. Importing while an identical project exists merges — no new card.
  await page.setInputFiles('[data-testid="import-file"]', zipPath);
  await page.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent.includes('Merged'));
  const toast = await page.textContent('[data-testid="toast"]');
  check('identical import merges into existing project',
    (await page.locator('[data-testid="project-card"]').count()) === 1
      && toast.includes('0 scenes added') && toast.includes('1 duplicate skipped'),
    toast);

  // 13. Import after deleting the original — full round-trip restore.
  page.once('dialog', (d) => d.accept());
  await page.click('[title="Delete project"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length === 0);
  await page.setInputFiles('[data-testid="import-file"]', zipPath);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length === 1);
  check('import stays on projects screen',
    await page.locator('[data-testid="project-title"]').count() === 0);
  await page.click('.card-title');
  await page.waitForSelector('[data-testid="scene-card"]');
  check('imported project restored', (await page.textContent('[data-testid="project-title"]')) === 'Callback Tape');
  await page.click('[data-testid="scene-card"] .card-title');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="line-row"]').length === 4);
  check('imported scene has all 4 lines', true);
  await page.click('[data-testid="tab-play"]');
  check('imported scene play ready', await waitForStatus(page, 'play-status', 'Press to play line 1 of 4'));
  await page.keyboard.press('Space');
  check('imported line plays', await waitForStatus(page, 'play-status', 'Playing line 1 of 4'));
  check('imported line plays to the end', await waitForStatus(page, 'play-status', 'Press to play line 2 of 4'));

  // 14. Drag & drop a duplicate ZIP while inside a project — merges and the
  // user stays exactly where they were.
  await page.click('.back'); // play view → scene list of 'Callback Tape'
  await page.waitForSelector('[data-testid="project-title"]');
  const zipB64 = readFileSync(zipPath).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'Callback Tape.zip', { type: 'application/zip' }));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    if (!document.querySelector('[data-testid="drop-overlay"]').classList.contains('visible')) {
      throw new Error('drop overlay did not appear on dragenter');
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, zipB64);
  await page.waitForFunction(() => document.querySelector('[data-testid="toast"]')?.textContent.includes('Merged'));
  check('drag-and-drop merges and stays inside the project',
    (await page.textContent('[data-testid="project-title"]')) === 'Callback Tape'
      && (await page.locator('[data-testid="scene-card"]').count()) === 1);
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-testid="project-card"]');
  check('still exactly one project after all imports',
    (await page.locator('[data-testid="project-card"]').count()) === 1);

  // 15. Drag the last card to the top of a list.
  const dragLastToTop = (selector) => page.evaluate((sel) => {
    const cards = [...document.querySelectorAll(sel)];
    const dragged = cards[cards.length - 1];
    const target = cards[0];
    const dt = new DataTransfer();
    dragged.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY: r.top + 1 }));
    dragged.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  }, selector);
  const titles = (sel) => page.$$eval(`${sel} .card-title`, (els) => els.map((e) => e.textContent));

  // Scenes: add two empty scenes, drag 'Beta' to the top, reload, order persists.
  await page.click('.card-title'); // into 'Callback Tape'
  await page.waitForSelector('[data-testid="scene-card"]');
  for (const name of ['Alpha', 'Beta']) {
    await page.fill('[data-testid="new-scene-name"]', name);
    await page.click('[data-testid="create-scene"]'); // jumps into record mode
    await page.waitForSelector('[data-testid="scene-title"]');
    await page.click('.back');
    await page.waitForSelector('[data-testid="scene-card"]');
  }
  await dragLastToTop('[data-testid="scene-card"]');
  await page.waitForTimeout(400); // let the order write settle
  await page.reload();
  await page.waitForSelector('[data-testid="scene-card"]');
  const sceneOrder = await titles('[data-testid="scene-card"]');
  check('scenes reorder by dragging and persist',
    JSON.stringify(sceneOrder) === JSON.stringify(['Beta', 'Opening Scene', 'Alpha']),
    sceneOrder.join(' → '));

  // Projects: add a second project, drag it to the top, reload, order persists.
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('[data-testid="new-project-name"]');
  await page.fill('[data-testid="new-project-name"]', 'Zed');
  await page.click('[data-testid="create-project"]');
  await page.waitForSelector('[data-testid="project-title"]');
  await page.goto(`${BASE}/#/`);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="project-card"]').length === 2);
  await dragLastToTop('[data-testid="project-card"]');
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('[data-testid="project-card"]');
  const projectOrder = await titles('[data-testid="project-card"]');
  check('projects reorder by dragging and persist',
    JSON.stringify(projectOrder) === JSON.stringify(['Zed', 'Callback Tape']),
    projectOrder.join(' → '));

  // 16. Storage persistence (grant depends on browser heuristics — informational)
  console.log(`INFO  storage persisted: ${await page.evaluate(() => navigator.storage.persisted())}`);
} catch (err) {
  failures++;
  console.error('FAIL  unexpected error:', err.message);
  try {
    const page = (await browser.contexts())[0]?.pages()[0] ?? browser.contexts()[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: new URL('../.context/verify-failure.png', import.meta.url).pathname });
      console.error('      state:', await page.evaluate(() => `${location.hash} | ${document.body.innerText.slice(0, 300).replace(/\n+/g, ' · ')}`));
    }
  } catch {}
} finally {
  await browser.close();
  server.kill();
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
