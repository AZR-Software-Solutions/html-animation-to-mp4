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

Turn a browser-rendered animation into a real MP4 video file. The high-quality paths
render **every frame at an exact timestamp** (no screen-recording jitter or dropped
frames), then encode with ffmpeg.

## Capture modes (auto-selected; override with a flag)

| Mode | When | Quality |
|---|---|---|
| **seek** | Claude Design timeline artifact (`*.dc.html`) — auto-detected | Frame-perfect; size + duration auto-detected |
| **virtual** (`--virtual`) | Any generic page, opt-in | Frame-perfect for JS/canvas/WebGL **and** CSS/WAAPI animations (experimental) |
| **realtime** | Any generic page, default | Best-effort; mild timing drift; most compatible |

- **seek** drives the Design engine's own per-frame hook (`data-om-seek-to-time-frame`)
  to each exact time. This is why Claude Design exports come out smooth and crisp with
  zero config — usually you pass nothing but the folder.
- **virtual** freezes the page's clock (`Date`, `performance.now`, `requestAnimationFrame`,
  timers, and CSS/Web-Animations time via `getAnimations().currentTime`) and steps it
  frame-by-frame. Use it when a generic animation must be frame-perfect. If a page
  misbehaves under it (some load-time timer chains can), fall back to default real-time.

## Prerequisites

- **Node 18+**, **`playwright`** (`npm i playwright && npx playwright install chromium`),
  and **`ffmpeg`** on PATH (`ffmpeg -version` should work).
- Run `scripts/render.mjs` from a directory where `playwright` resolves (this skill folder
  after `npm install`, or copy the script next to an existing Playwright install).

## Quick start

```bash
# Claude Design artifact — point at the folder; size + duration auto-detect:
node scripts/render.mjs "path/to/My Animation" --fps 30

# A single entry .html (Design or generic):
node scripts/render.mjs path/to/promo.dc.html

# Generic animation, best-effort real-time (give it a duration):
node scripts/render.mjs ./banner --duration 8 --width 1080 --height 1080

# Generic animation, frame-perfect deterministic:
node scripts/render.mjs ./banner --virtual --duration 8 --width 1080 --height 1080
```

Output defaults to `<input-dir>/<name>.mp4`; use `--out` to choose.

## Options

| Flag | Meaning | Default |
|---|---|---|
| `--out <file>` | Output MP4 path | `<input-dir>/<name>.mp4` |
| `--fps <n>` | Frames per second (60 = ultra-smooth) | `30` |
| `--duration <s>` | Length in seconds | auto (seek) / **required** (virtual & realtime) |
| `--width` / `--height` | Output pixels | auto (seek) / `1920×1080` (generic) |
| `--selector <css>` | Element to capture | Design canvas, else full page |
| `--scale <n>` | Supersample then downscale for crispness | `1` (use `2` for extra sharp) |
| `--crf <n>` | x264 quality, lower = better/bigger | `18` |
| `--bg <color>` | Background for transparent generic pages | `#000000` |
| `--virtual` | Deterministic virtual-clock capture (generic) | off |
| `--realtime` | Force best-effort real-time capture | off |
| `--keep-frames` | Keep the intermediate PNGs (e.g. for a poster) | off |

## Examples

```bash
# Vertical promo (Reels/TikTok/Shorts), 60fps:
node scripts/render.mjs "marketing/My Promo" --fps 60

# Square cut for LinkedIn, extra-sharp:
node scripts/render.mjs ./promo.dc.html --width 1080 --height 1080 --scale 2 --out promo-square.mp4

# A hand-written canvas/WebGL loop, frame-perfect:
node scripts/render.mjs ./scene.html --virtual --duration 6 --fps 60 --selector "#stage"
```

## Add a music / audio track (bonus)

Capture is silent (frames only). Mux a soundtrack in afterward:

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 -shortest out-with-audio.mp4
```

## Troubleshooting

- **Black/blank frames:** the page is served over a local http server (the script starts
  one) — don't open `file://`. The script already waits for `document.fonts.ready`, images,
  and a settle delay; raise it if a heavy page needs more.
- **Fonts look wrong:** Design artifacts pull Google Fonts over the network — be online.
- **`--virtual` page acts weird:** some libraries start timers at load that a virtual clock
  reorders. Fall back to default real-time, or capture a Design artifact (seek mode).
- **`ffmpeg failed`:** install ffmpeg and confirm `ffmpeg -version` runs.

## How it works (deeper)

See `references/how-it-works.md` for the seek protocol, the virtual-clock internals and
caveats, ffmpeg/quality settings, supersampling, and adding audio.
