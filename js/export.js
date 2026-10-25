// export.js — save a project as one ZIP, and open a saved ZIP back up.
// The ZIP holds the audio in folders plus a manifest with names and order:
//   manifest.json
//   <Project name>/<Scene name>/line-01.webm, line-02.webm, …
// Importing a ZIP recreates the project exactly, so scenes transfer
// between devices by moving a single file.

import * as db from './db.js';
import { makeZip, readZip } from './zip.js';

function ext(mimeType = '') {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'untitled';
}

export async function saveProject(project) {
  const scenes = await db.listScenes(project.id);
  const projectFolder = safeName(project.name);
  const entries = [];
  const manifest = { app: 'scenestudy', version: 1, project: project.name, scenes: [] };

  const seen = new Set();
  for (const scene of scenes) {
    let folder = safeName(scene.name);
    for (let n = 2; seen.has(folder); n++) folder = `${safeName(scene.name)} (${n})`;
    seen.add(folder);

    const lines = await db.listLines(scene.id);
    const sceneManifest = { name: scene.name, lines: [] };
    for (const line of lines) {
      const path = `${projectFolder}/${folder}/line-${String(line.index + 1).padStart(2, '0')}.${ext(line.mimeType)}`;
      entries.push({ path, blob: line.blob });
      sceneManifest.lines.push({ file: path, mimeType: line.mimeType, duration: line.duration });
    }
    manifest.scenes.push(sceneManifest);
  }
  entries.unshift({ path: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)]) });

  const zip = await makeZip(entries);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = `${projectFolder}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Reads a saved ZIP and recreates its project. Returns the new project.
export async function importProject(file) {
  const entries = readZip(await file.arrayBuffer());
  const manifestEntry = entries.find((e) => e.path === 'manifest.json');
  if (!manifestEntry) throw new Error('this ZIP is not a SceneStudy export (no manifest.json)');
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  if (manifest.app !== 'scenestudy') throw new Error('this ZIP is not a SceneStudy export');

  const byPath = new Map(entries.map((e) => [e.path, e]));
  const project = await db.createProject(manifest.project);
  for (const sceneManifest of manifest.scenes) {
    const scene = await db.createScene(project.id, sceneManifest.name);
    for (const line of sceneManifest.lines) {
      const entry = byPath.get(line.file);
      if (!entry) throw new Error(`audio missing from ZIP: ${line.file}`);
      await db.addLine(scene.id, {
        blob: new Blob([entry.bytes], { type: line.mimeType }),
        mimeType: line.mimeType,
        duration: line.duration,
      });
    }
  }
  return project;
}
