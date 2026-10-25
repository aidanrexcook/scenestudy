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

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// A scene's identity is its audio content: the ordered hashes of its lines.
async function sceneSignature(lineBytes) {
  const hashes = [];
  for (const b of lineBytes) hashes.push(await sha256Hex(b));
  return hashes.join('|');
}

// Reads a saved ZIP and restores its project. If a project with the same
// name already exists, merges into it: scenes whose audio is identical to
// an existing scene are skipped, so re-importing never creates duplicates.
// Returns { project, merged, added, skipped }.
export async function importProject(file) {
  const entries = readZip(await file.arrayBuffer());
  const manifestEntry = entries.find((e) => e.path === 'manifest.json');
  if (!manifestEntry) throw new Error('this ZIP is not a SceneStudy export (no manifest.json)');
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
  if (manifest.app !== 'scenestudy') throw new Error('this ZIP is not a SceneStudy export');
  const byPath = new Map(entries.map((e) => [e.path, e]));

  const existing = (await db.listProjects()).find((p) => p.name === manifest.project);
  const project = existing || await db.createProject(manifest.project);

  // Content signatures and names of scenes already in the target project.
  const existingSigs = new Set();
  const namesTaken = new Set();
  if (existing) {
    for (const scene of await db.listScenes(project.id)) {
      namesTaken.add(scene.name);
      const lines = await db.listLines(scene.id);
      const bytes = await Promise.all(lines.map((l) => l.blob.arrayBuffer()));
      existingSigs.add(await sceneSignature(bytes.map((b) => new Uint8Array(b))));
    }
  }

  let added = 0;
  let skipped = 0;
  for (const sceneManifest of manifest.scenes) {
    const lineBytes = sceneManifest.lines.map((line) => {
      const entry = byPath.get(line.file);
      if (!entry) throw new Error(`audio missing from ZIP: ${line.file}`);
      return entry.bytes;
    });
    const sig = await sceneSignature(lineBytes);
    if (existingSigs.has(sig)) { skipped += 1; continue; } // identical scene already there
    existingSigs.add(sig);

    // Same name but different audio: keep both, suffixing the newcomer.
    let name = sceneManifest.name;
    for (let n = 2; namesTaken.has(name); n++) name = `${sceneManifest.name} (${n})`;
    namesTaken.add(name);

    const scene = await db.createScene(project.id, name);
    for (const [i, line] of sceneManifest.lines.entries()) {
      await db.addLine(scene.id, {
        blob: new Blob([lineBytes[i]], { type: line.mimeType }),
        mimeType: line.mimeType,
        duration: line.duration,
      });
    }
    added += 1;
  }
  return { project, merged: !!existing, added, skipped };
}
