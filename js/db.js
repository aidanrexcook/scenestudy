// db.js — all persistence. Three stores: projects, scenes, lines.
// A line's audio lives in the `blob` field of its record.

const DB_NAME = 'scenestudy';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        const scenes = db.createObjectStore('scenes', { keyPath: 'id' });
        scenes.createIndex('projectId', 'projectId');
        const lines = db.createObjectStore('lines', { keyPath: 'id' });
        lines.createIndex('sceneId', 'sceneId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

const id = () => crypto.randomUUID();

// ---- Projects ----

export async function listProjects() {
  const all = await promisify((await store('projects')).getAll());
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getProject(projectId) {
  return promisify((await store('projects')).get(projectId));
}

export async function createProject(name) {
  const project = { id: id(), name, createdAt: Date.now() };
  await promisify((await store('projects', 'readwrite')).add(project));
  return project;
}

export async function renameProject(projectId, name) {
  const s = await store('projects', 'readwrite');
  const project = await promisify(s.get(projectId));
  project.name = name;
  await promisify(s.put(project));
}

export async function deleteProject(projectId) {
  const db = await openDB();
  const tx = db.transaction(['projects', 'scenes', 'lines'], 'readwrite');
  const scenes = await promisify(tx.objectStore('scenes').index('projectId').getAll(projectId));
  for (const scene of scenes) {
    const lines = await promisify(tx.objectStore('lines').index('sceneId').getAll(scene.id));
    for (const line of lines) tx.objectStore('lines').delete(line.id);
    tx.objectStore('scenes').delete(scene.id);
  }
  tx.objectStore('projects').delete(projectId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Scenes ----

export async function listScenes(projectId) {
  const all = await promisify((await store('scenes')).index('projectId').getAll(projectId));
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getScene(sceneId) {
  return promisify((await store('scenes')).get(sceneId));
}

export async function createScene(projectId, name) {
  const scene = { id: id(), projectId, name, createdAt: Date.now() };
  await promisify((await store('scenes', 'readwrite')).add(scene));
  return scene;
}

export async function renameScene(sceneId, name) {
  const s = await store('scenes', 'readwrite');
  const scene = await promisify(s.get(sceneId));
  scene.name = name;
  await promisify(s.put(scene));
}

export async function deleteScene(sceneId) {
  const db = await openDB();
  const tx = db.transaction(['scenes', 'lines'], 'readwrite');
  const lines = await promisify(tx.objectStore('lines').index('sceneId').getAll(sceneId));
  for (const line of lines) tx.objectStore('lines').delete(line.id);
  tx.objectStore('scenes').delete(sceneId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Lines ----

export async function listLines(sceneId) {
  const all = await promisify((await store('lines')).index('sceneId').getAll(sceneId));
  return all.sort((a, b) => a.index - b.index);
}

export async function addLine(sceneId, { blob, mimeType, duration }) {
  const existing = await listLines(sceneId);
  const line = {
    id: id(), sceneId, index: existing.length,
    blob, mimeType, duration, createdAt: Date.now(),
  };
  await promisify((await store('lines', 'readwrite')).add(line));
  return line;
}

export async function replaceLineAudio(lineId, { blob, mimeType, duration }) {
  const s = await store('lines', 'readwrite');
  const line = await promisify(s.get(lineId));
  Object.assign(line, { blob, mimeType, duration });
  await promisify(s.put(line));
}

export async function deleteLine(lineId) {
  const s = await store('lines', 'readwrite');
  const line = await promisify(s.get(lineId));
  await promisify(s.delete(lineId));
  // Close the gap so indexes stay 0..n-1 in recorded order.
  const rest = await promisify(s.index('sceneId').getAll(line.sceneId));
  for (const other of rest.sort((a, b) => a.index - b.index)) {
    if (other.index > line.index) {
      other.index -= 1;
      await promisify(s.put(other));
    }
  }
}
