// recorder.js — microphone capture. One Recorder per record-mode visit:
// init() grabs the mic, start()/stop() bracket one line, dispose() releases the mic.

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

export class Recorder {
  constructor() {
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  async init() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  get recording() {
    return !!this.rec && this.rec.state === 'recording';
  }

  start() {
    if (!this.stream || this.recording) return;
    const mimeType = pickMimeType();
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    this.rec.start();
  }

  // Resolves with the finished clip. Duration comes from the wall clock —
  // MediaRecorder blobs often report Infinity, so we don't ask the blob.
  stop() {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state !== 'recording') { resolve(null); return; }
      rec.onstop = () => {
        const duration = (performance.now() - this.startedAt) / 1000;
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' });
        this.rec = null;
        this.chunks = [];
        resolve({ blob, mimeType: blob.type, duration });
      };
      rec.stop();
    });
  }

  dispose() {
    if (this.rec && this.rec.state === 'recording') this.rec.stop();
    this.rec = null;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}
