# SceneStudy

Record a reader's lines for a self-tape, then play them back one line at a time with a single press while you film.

## What it needs to run

- Any modern browser (Chrome, Safari, Edge — laptop or iPad)
- A local web server (mic access requires localhost or HTTPS)

## Run it

```sh
python3 -m http.server 8000
# or: npx serve
```

Then open http://localhost:8000 and allow microphone access.

## How it's organized

- **Project** — one self-tape job; holds scenes. Renameable.
- **Scene** — one sequence of reader lines. Renameable.
- **Line** — one audio clip. Lines always play in the order recorded.

Everything is stored locally in the browser (IndexedDB). Nothing leaves the device.

## Using it

**Record mode** — pick a capture style with the toggle:
- *Tap start / stop*: press once to start a line, again to finish it.
- *Hold to record*: record while the button (or spacebar) is held.

Each finished recording becomes the next line. Any line can be previewed (▶), re-recorded (⟳), or deleted (✕).

**Play mode** — tap anywhere on the stage, or press spacebar:
- One press plays the next line in full.
- Hold for 1 second to reset to line 1, paused.

## Code layout

- `js/db.js` — storage (projects / scenes / lines in IndexedDB)
- `js/recorder.js` — microphone capture (MediaRecorder)
- `js/player.js` — sequential playback with reset
- `js/app.js` — screens, routing, and input handling
