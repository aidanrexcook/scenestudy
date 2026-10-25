// app.js — screens and input handling.
// Routes: #/            projects list
//         #/project/ID  scenes in a project
//         #/scene/ID/record  and  #/scene/ID/play
import * as db from './db.js';
import { Recorder } from './recorder.js';
import { SequencePlayer } from './player.js';
import { saveProject, importProject } from './export.js';

// Ask the browser to exempt our recordings from automatic storage eviction.
navigator.storage?.persist?.().catch(() => {});

const HOLD_MS = 1000; // hold this long in play mode to reset to line 1

const app = document.getElementById('app');
let cleanup = null; // teardown for the current view (listeners, mic, audio)

// ---- tiny DOM helper ----
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function fmtDuration(s) {
  return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`;
}

// Save button: downloads the project as one ZIP, flashes ✓ when done.
function saveButton(project) {
  const btn = el('button', { class: 'icon-btn', title: 'Save project as a ZIP file', dataset: { testid: 'save-project' } }, '⬇');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await saveProject(project);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '⬇'; }, 1500);
    } catch (err) {
      alert(`Could not save project: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

// Inline rename: swaps a title for an input; Enter/blur saves, Escape cancels.
function startRename(titleEl, currentName, save) {
  const input = el('input', { class: 'rename-input', value: currentName });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (commit && name && name !== currentName) await save(name);
    route(); // re-render the view fresh
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
}

// ---- Projects list ----
async function renderProjects() {
  const projects = await db.listProjects();
  const list = el('div', { class: 'card-list' });
  for (const p of projects) {
    const title = el('a', { class: 'card-title', href: `#/project/${p.id}` }, p.name);
    list.append(el('div', { class: 'card', dataset: { testid: 'project-card' } },
      title,
      el('div', { class: 'card-actions' },
        saveButton(p),
        el('button', { class: 'icon-btn', title: 'Rename project',
          onclick: () => startRename(title, p.name, (name) => db.renameProject(p.id, name)) }, '✎'),
        el('button', { class: 'icon-btn danger', title: 'Delete project',
          onclick: async () => {
            if (confirm(`Delete project “${p.name}” and all its scenes?`)) {
              await db.deleteProject(p.id);
              route();
            }
          } }, '✕'),
      ),
    ));
  }
  if (!projects.length) {
    list.append(el('p', { class: 'hint' }, 'No projects yet. A project holds the scenes for one self-tape.'));
  }

  const nameInput = el('input', { class: 'new-input', placeholder: 'New project name', dataset: { testid: 'new-project-name' } });
  const create = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const project = await db.createProject(name);
    location.hash = `#/project/${project.id}`; // jump straight into the new project
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  // Import: open a saved ZIP and jump into the restored project.
  const importInput = el('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none', dataset: { testid: 'import-file' } });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const project = await importProject(file);
      location.hash = `#/project/${project.id}`;
    } catch (err) {
      alert(`Could not import: ${err.message}`);
      importInput.value = '';
    }
  });

  app.replaceChildren(
    el('header', {}, el('h1', {}, 'SceneStudy'), el('p', { class: 'tagline' }, 'Record a reader’s lines, play them back one press at a time.')),
    el('section', {},
      el('h2', {}, 'Projects'),
      list,
      el('div', { class: 'new-row' }, nameInput,
        el('button', { class: 'btn', dataset: { testid: 'create-project' }, onclick: create }, 'Create'),
        el('button', { class: 'btn secondary', dataset: { testid: 'import-project' }, onclick: () => importInput.click() }, 'Import ZIP'),
        importInput),
    ),
  );
}

// ---- Project view: scenes ----
async function renderProject(projectId) {
  const project = await db.getProject(projectId);
  if (!project) { location.hash = '#/'; return; }
  const scenes = await db.listScenes(projectId);

  const list = el('div', { class: 'card-list' });
  for (const s of scenes) {
    const title = el('a', { class: 'card-title', href: `#/scene/${s.id}/record` }, s.name);
    list.append(el('div', { class: 'card', dataset: { testid: 'scene-card' } },
      title,
      el('div', { class: 'card-actions' },
        el('button', { class: 'icon-btn', title: 'Rename scene',
          onclick: () => startRename(title, s.name, (name) => db.renameScene(s.id, name)) }, '✎'),
        el('button', { class: 'icon-btn danger', title: 'Delete scene',
          onclick: async () => {
            if (confirm(`Delete scene “${s.name}” and its recorded lines?`)) {
              await db.deleteScene(s.id);
              route();
            }
          } }, '✕'),
      ),
    ));
  }
  if (!scenes.length) {
    list.append(el('p', { class: 'hint' }, 'No scenes yet. A scene is one sequence of reader lines.'));
  }

  const nameInput = el('input', { class: 'new-input', placeholder: 'New scene name', dataset: { testid: 'new-scene-name' } });
  const create = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const scene = await db.createScene(projectId, name);
    location.hash = `#/scene/${scene.id}/record`; // jump straight into recording
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const projectTitle = el('h1', { dataset: { testid: 'project-title' } }, project.name);
  app.replaceChildren(
    el('header', {},
      el('a', { class: 'back', href: '#/' }, '← Projects'),
      projectTitle,
      saveButton(project),
      el('button', { class: 'icon-btn', title: 'Rename project',
        onclick: () => startRename(projectTitle, project.name, (name) => db.renameProject(project.id, name)) }, '✎'),
    ),
    el('section', {},
      el('h2', {}, 'Scenes'),
      list,
      el('div', { class: 'new-row' }, nameInput,
        el('button', { class: 'btn', dataset: { testid: 'create-scene' }, onclick: create }, 'Create')),
    ),
  );
}

// ---- Scene view scaffolding (shared by record + play) ----
async function sceneHeader(scene, mode) {
  const title = el('h1', { dataset: { testid: 'scene-title' } }, scene.name);
  return el('header', {},
    el('a', { class: 'back', href: `#/project/${scene.projectId}` }, '← Scenes'),
    title,
    el('button', { class: 'icon-btn', title: 'Rename scene',
      onclick: () => startRename(title, scene.name, (name) => db.renameScene(scene.id, name)) }, '✎'),
    el('nav', { class: 'tabs' },
      el('a', { class: `tab ${mode === 'record' ? 'active' : ''}`, href: `#/scene/${scene.id}/record` }, 'Record'),
      el('a', { class: `tab ${mode === 'play' ? 'active' : ''}`, href: `#/scene/${scene.id}/play`, dataset: { testid: 'tab-play' } }, 'Play'),
    ),
  );
}

// ---- Record mode ----
async function renderRecord(sceneId) {
  const scene = await db.getScene(sceneId);
  if (!scene) { location.hash = '#/'; return; }

  const recorder = new Recorder();
  let captureMode = localStorage.getItem('scenestudy.captureMode') || 'tap'; // 'tap' | 'hold'
  let rerecordLine = null; // line being replaced, or null = append
  let micError = null;
  let micReady = false;

  const status = el('p', { class: 'status', dataset: { testid: 'record-status' } });
  const recordBtn = el('button', { class: 'record-btn', dataset: { testid: 'record-btn' } }, el('span', { class: 'record-dot' }));
  const linesBox = el('div', { class: 'lines' });
  const modeToggle = el('div', { class: 'seg' });

  const preview = new Audio();
  let previewUrl = null;
  let previewingId = null;
  preview.addEventListener('ended', () => { previewingId = null; refreshLines(); });

  function setStatus() {
    if (micError) { status.textContent = micError; status.classList.add('error'); return; }
    status.classList.remove('error');
    if (!micReady) { status.textContent = 'Requesting microphone…'; return; }
    if (recorder.recording) {
      status.textContent = rerecordLine
        ? `Recording — replaces line ${rerecordLine.index + 1}`
        : `Recording line ${nextLineNumber}…`;
    } else if (rerecordLine) {
      status.textContent = `Ready to re-record line ${rerecordLine.index + 1} — ${captureMode === 'tap' ? 'press to start' : 'hold to record'}`;
    } else {
      status.textContent = `Ready — ${captureMode === 'tap' ? 'press to start line' : 'hold to record line'} ${nextLineNumber}`;
    }
    recordBtn.classList.toggle('recording', recorder.recording);
  }

  let nextLineNumber = 1;
  async function refreshLines() {
    const lines = await db.listLines(sceneId);
    nextLineNumber = lines.length + 1;
    linesBox.replaceChildren(...lines.map((line) => el('div', { class: `line-row ${rerecordLine?.id === line.id ? 'armed' : ''}`, dataset: { testid: 'line-row' } },
      el('span', { class: 'line-num' }, `Line ${line.index + 1}`),
      el('span', { class: 'line-dur' }, fmtDuration(line.duration)),
      el('span', { class: 'line-actions' },
        el('button', { class: 'icon-btn', title: 'Preview line', onclick: () => {
          if (previewingId === line.id) {
            preview.pause(); previewingId = null;
          } else {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(line.blob);
            preview.src = previewUrl;
            preview.play();
            previewingId = line.id;
          }
          refreshLines();
        } }, previewingId === line.id ? '⏹' : '▶'),
        el('button', { class: 'icon-btn', title: 'Re-record this line', onclick: () => {
          rerecordLine = rerecordLine?.id === line.id ? null : line;
          setStatus(); refreshLines();
        } }, '⟳'),
        el('button', { class: 'icon-btn danger', title: 'Delete line', onclick: async () => {
          if (confirm(`Delete line ${line.index + 1}?`)) {
            if (rerecordLine?.id === line.id) rerecordLine = null;
            await db.deleteLine(line.id);
            await refreshLines(); setStatus();
          }
        } }, '✕'),
      ),
    )));
    if (!lines.length) linesBox.replaceChildren(el('p', { class: 'hint' }, 'No lines yet. Each recording becomes the next line in the sequence.'));
    setStatus();
  }

  function renderModeToggle() {
    modeToggle.replaceChildren(
      ...[['tap', 'Tap start / stop'], ['hold', 'Hold to record']].map(([value, label]) =>
        el('button', {
          class: `seg-btn ${captureMode === value ? 'active' : ''}`,
          dataset: { testid: `mode-${value}` },
          onclick: () => {
            if (recorder.recording) return;
            captureMode = value;
            localStorage.setItem('scenestudy.captureMode', value);
            renderModeToggle(); setStatus();
          },
        }, label)),
    );
  }

  async function startCapture() {
    if (recorder.recording || micError || !micReady) return;
    recorder.start();
    setStatus();
  }

  async function stopCapture() {
    if (!recorder.recording) return;
    const clip = await recorder.stop();
    if (clip) {
      if (rerecordLine) {
        await db.replaceLineAudio(rerecordLine.id, clip);
        rerecordLine = null;
      } else {
        await db.addLine(sceneId, clip);
      }
    }
    await refreshLines();
  }

  // Button input, branching on capture mode.
  recordBtn.addEventListener('click', () => {
    if (captureMode !== 'tap') return;
    recorder.recording ? stopCapture() : startCapture();
  });
  recordBtn.addEventListener('pointerdown', (e) => {
    if (captureMode !== 'hold') return;
    e.preventDefault();
    recordBtn.setPointerCapture(e.pointerId);
    startCapture();
  });
  const holdStop = () => { if (captureMode === 'hold') stopCapture(); };
  recordBtn.addEventListener('pointerup', holdStop);
  recordBtn.addEventListener('pointercancel', holdStop);
  recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // Spacebar mirrors the button on a laptop.
  const onKeyDown = (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (e.repeat) return;
    if (captureMode === 'tap') recorder.recording ? stopCapture() : startCapture();
    else startCapture();
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    if (captureMode === 'hold') stopCapture();
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    preview.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    recorder.dispose();
  };

  app.replaceChildren(
    await sceneHeader(scene, 'record'),
    el('section', { class: 'record-pane' },
      modeToggle,
      recordBtn,
      status,
      el('h2', {}, 'Lines'),
      linesBox,
    ),
  );
  renderModeToggle();
  await refreshLines();

  try {
    await recorder.init();
    micReady = true;
  } catch (err) {
    micError = 'Microphone unavailable — allow mic access in the browser and reload.';
  }
  setStatus();
}

// ---- Play mode ----
async function renderPlay(sceneId) {
  const scene = await db.getScene(sceneId);
  if (!scene) { location.hash = '#/'; return; }
  const lines = await db.listLines(sceneId);

  const status = el('p', { class: 'status big', dataset: { testid: 'play-status' } });
  const lineList = el('div', { class: 'lines compact' });
  const stage = el('div', { class: 'stage', dataset: { testid: 'stage' } },
    status,
    el('p', { class: 'hint' }, lines.length
      ? 'Press space or tap anywhere in this area to play the next line. Hold 1 second to reset to line 1.'
      : 'Record some lines first, then play them back here.'),
  );

  const player = new SequencePlayer(lines, update);

  function update() {
    const n = player.count;
    if (!n) status.textContent = 'No lines recorded yet';
    else if (player.playingIndex !== null) status.textContent = `Playing line ${player.playingIndex + 1} of ${n}`;
    else if (player.nextIndex >= n) status.textContent = 'End of scene — hold to reset';
    else status.textContent = `Press to play line ${player.nextIndex + 1} of ${n}`;
    stage.classList.toggle('playing', player.playingIndex !== null);
    lineList.replaceChildren(...lines.map((line, i) =>
      el('div', { class: `line-row ${player.playingIndex === i ? 'current' : ''} ${i < player.nextIndex ? 'done' : ''}` },
        el('span', { class: 'line-num' }, `Line ${i + 1}`),
        el('span', { class: 'line-dur' }, fmtDuration(line.duration)),
      )));
  }

  // One input = next line; holding past HOLD_MS resets to line 1, paused.
  let holdTimer = null;
  let pressed = false;
  function press() {
    if (pressed) return;
    pressed = true;
    player.advance();
    holdTimer = setTimeout(() => {
      player.reset();
      stage.classList.add('reset-flash');
      setTimeout(() => stage.classList.remove('reset-flash'), 400);
    }, HOLD_MS);
  }
  function release() {
    pressed = false;
    clearTimeout(holdTimer);
  }

  stage.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  const onKeyDown = (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    if (!e.repeat) press();
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space') release();
  };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    clearTimeout(holdTimer);
    player.dispose();
  };

  app.replaceChildren(
    await sceneHeader(scene, 'play'),
    el('section', { class: 'play-pane' }, stage, lineList),
  );
  update();
}

// ---- Router ----
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const hash = location.hash || '#/';
  let m;
  if ((m = hash.match(/^#\/project\/([\w-]+)$/))) await renderProject(m[1]);
  else if ((m = hash.match(/^#\/scene\/([\w-]+)\/record$/))) await renderRecord(m[1]);
  else if ((m = hash.match(/^#\/scene\/([\w-]+)\/play$/))) await renderPlay(m[1]);
  else await renderProjects();
}

window.addEventListener('hashchange', route);
route();
