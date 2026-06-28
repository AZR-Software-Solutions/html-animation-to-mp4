---
name: html-animation-to-mp4
description: >-
  Convert an HTML/CSS/JS animation — especially a Claude "Design" timeline artifact
  (a *.dc.html bundle exported from Claude) — into a clean, shareable MP4 using
  deterministic headless-browser frame capture plus ffmpeg. Use this whenever the user
  has a web/HTML animation, a Claude Design or Artifacts animation, a `.dc.html` file,
  an animated promo / explainer / motion graphic, and wants a video file (MP4, reel,
  short, clip) out of it — even if they don't say "render", "ffmpeg", or "headless".
  Trigger on phrasings like "convert this animation to mp4/video", "export my HTML
  animation as a video", "turn this Claude design into a video", "make a reel/short
  from this animation", or "I built an animation in HTML and need an mp4". Prefer this
  over naive screen-recording: it captures frame-perfect, at any resolution/fps.
---

# html-animation-to-mp4

Turn a browser-rendered animation into a real MP4 video file. The high-quality path
renders **every frame at an exact timestamp** (no screen-recording jitter or dropped
frames), then encodes with ffmpeg.

## Two modes (auto-selected)

1. **Claude Design timeline artifact (flagship, deterministic).** Claude "Design"
   animations export as a `*.dc.html` plus sibling `.jsx`/`support.js`/`assets`. Their
   engine exposes a per-frame seek hook (`data-om-seek-to-time-frame`), so the script
   drives the playhead to each exact time, waits for the render to commit, and captures
   it. **Canvas size and duration are auto-detected** from the Stage — you usually pass
   nothing but the folder. This is what makes the result smooth and crisp.
2. **Generic HTML/CSS/JS animation (fallback, real-time).** Any other animated page is
   played and captured best-effort in real time. You must supply `--duration`; size
   defaults to 1920×1080.

## Prerequisites

- **Node 18+**, **`playwright`** (`npm i playwright && npx playwright install chromium`),
  and **`ffmpeg`** on PATH (`ffmpeg -version` should work).
- The script (`scripts/render.mjs`) resolves `playwright` from wherever it runs, so run
  it from a directory that has `playwright` installed (e.g. `npm i` in this skill folder,
  or copy `render.mjs` next to an existing Playwright install).

## Quick start

```bash
# Claude Design artifact — point at the folder; size + duration auto-detect.
node scripts/render.mjs "path/to/My Animation"  --fps 30

# A single entry .html (Design or generic):
node scripts/render.mjs "path/to/promo.dc.html"

# Generic HTML animation — give it a duration:
node scripts/render.mjs ./banner --duration 8 --width 1080 --height 1080
```

Output defaults to `<input-dir>/<name>.mp4`. Use `--out` to choose the path.

## Options

| Flag | Meaning | Default |
|---|---|---|
| `--out <file>` | Output MP4 path | `<input-dir>/<name>.mp4` |
| `--fps <n>` | Frames per second (try 60 for ultra-smooth) | `30` |
| `--duration <s>` | Length in seconds | auto (Design) / **required** (generic) |
| `--width` / `--height` | Output pixels | auto (Design) / `1920×1080` (generic) |
| `--selector <css>` | Element to capture | Design canvas, else full page |
| `--scale <n>` | Supersample then downscale for crispness | `1` (use `2` for extra sharp) |
| `--crf <n>` | x264 quality, lower = better/bigger | `18` |
| `--bg <color>` | Background for transparent generic pages | `#000000` |
| `--realtime` | Force real-time capture even for a Design artifact | off |
| `--keep-frames` | Keep the intermediate PNGs | off |

## Examples

```bash
# Vertical promo (Reels/TikTok/Shorts), 60fps:
node scripts/render.mjs "marketing/My Promo" --fps 60

# Square cut for LinkedIn, extra-sharp:
node scripts/render.mjs ./promo.dc.html --width 1080 --height 1080 --scale 2 --out promo-square.mp4
```

## Add a music / audio track (bonus)

The capture is silent (frames only). To add a soundtrack, mux it in afterward:

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 -shortest out-with-audio.mp4
```

## Troubleshooting

- **Black or blank frames:** the page needs the local server (the script starts one) —
  don't open `file://` directly. Give it a moment after load; the script already waits for
  `document.fonts.ready`, images, and a settle delay.
- **Fonts look wrong:** Design artifacts pull Google Fonts over the network — ensure the
  machine is online during capture.
- **Generic animation timing drifts:** real-time capture is best-effort. For frame-perfect
  generic output, the animation needs a seek hook; Claude Design artifacts have one. See
  `references/how-it-works.md` for the planned deterministic virtual-clock mode.
- **`ffmpeg failed`:** install ffmpeg and confirm `ffmpeg -version` runs.

## How it works (deeper)

See `references/how-it-works.md` for the deterministic seek protocol, why this beats
screen-recording, ffmpeg/quality settings, supersampling, and adding audio.
