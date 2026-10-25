// export.js — save a project to the device as a folder:
//   <chosen location>/<Project name>/<Scene name>/line-01.webm, line-02.webm, …
// Chrome/Edge write a real folder (File System Access API). Browsers without
// that (Safari/iPad) get a ZIP download with the same folder layout inside.

import * as db from './db.js';
import { makeZip } from './zip.js';

function ext(mimeType = '') {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function safeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'untitled';
}

function lineFileName(line) {
  return `line-${String(line.index + 1).padStart(2, '0')}.${ext(line.mimeType)}`;
}

// Gather scenes + lines, de-duplicating scene folder names.
async function collect(projectId) {
  const scenes = await db.listScenes(projectId);
  const result = [];
  const seen = new Set();
  for (const scene of scenes) {
    let name = safeName(scene.name);
    for (let n = 2; seen.has(name); n++) name = `${safeName(scene.name)} (${n})`;
    seen.add(name);
    result.push({ name, lines: await db.listLines(scene.id) });
  }
  return result;
}

// Returns 'folder', 'zip', or 'cancelled'.
export async function saveProject(project) {
  const scenes = await collect(project.id);
  const projectName = safeName(project.name);

  if (window.showDirectoryPicker) {
    let root;
    try {
      root = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'; // user closed the picker
      throw err;
    }
    const projectDir = await root.getDirectoryHandle(projectName, { create: true });
    for (const { name, lines } of scenes) {
      const sceneDir = await projectDir.getDirectoryHandle(name, { create: true });
      for (const line of lines) {
        const file = await sceneDir.getFileHandle(lineFileName(line), { create: true });
        const writable = await file.createWritable();
        await writable.write(line.blob);
        await writable.close();
      }
    }
    return 'folder';
  }

  const entries = [];
  for (const { name, lines } of scenes) {
    for (const line of lines) {
      entries.push({ path: `${projectName}/${name}/${lineFileName(line)}`, blob: line.blob });
    }
  }
  const zip = await makeZip(entries);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = `${projectName}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'zip';
}
