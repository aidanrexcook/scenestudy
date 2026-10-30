// player.js — sequential playback of a scene's lines.
// advance() plays the next line in full; reset() returns to line 1, paused.
// onChange fires whenever playing state moves, so the view can re-render.

export class SequencePlayer {
  constructor(lines, onChange) {
    this.lines = lines;          // [{ blob, ... }] in play order
    this.nextIndex = 0;          // which line the next input plays
    this.playingIndex = null;    // currently sounding line, or null
    this.pausedIndex = null;     // line paused mid-way (hold-to-play mode), or null
    this.onChange = onChange;
    this.audio = new Audio();
    this.url = null;
    this.audio.addEventListener('ended', () => {
      this.playingIndex = null;
      this.onChange();
    });
  }

  get count() { return this.lines.length; }

  advance() {
    if (this.nextIndex >= this.lines.length) return; // end of scene; reset to replay
    this.stopCurrent();
    this.pausedIndex = null;
    const i = this.nextIndex;
    this.nextIndex += 1;
    this.playingIndex = i;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(this.lines[i].blob);
    this.audio.src = this.url;
    this.audio.play().catch(() => { /* surfaced via UI state staying idle */ });
    this.onChange();
  }

  reset() {
    this.stopCurrent();
    this.pausedIndex = null;
    this.nextIndex = 0;
    this.onChange();
  }

  // Hold-to-play mode: pause mid-line on release, resume (or start the next
  // line) on the next hold.
  pause() {
    if (this.playingIndex !== null) {
      this.audio.pause();
      this.pausedIndex = this.playingIndex;
      this.playingIndex = null;
      this.onChange();
    }
  }

  resumeOrAdvance() {
    if (this.pausedIndex !== null) {
      this.playingIndex = this.pausedIndex;
      this.pausedIndex = null;
      this.audio.play().catch(() => {});
      this.onChange();
    } else {
      this.advance();
    }
  }

  stopCurrent() {
    if (this.playingIndex !== null) {
      this.audio.pause();
      this.playingIndex = null;
    }
  }

  dispose() {
    this.stopCurrent();
    this.audio.removeAttribute('src');
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
