# html-animation-to-mp4

> Turn an HTML/CSS/JS animation — especially a **Claude “Design” timeline artifact** — into a clean, shareable **MP4**, frame-perfect, via headless-browser capture + ffmpeg.

[![License: MIT](https://img.shields.io/badge/License-MIT-7C3AED.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg)
![Playwright](https://img.shields.io/badge/engine-Playwright%20%2B%20ffmpeg-blue.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

Ships **two ways at once**: a standalone **CLI** and a drop-in **[Claude skill](SKILL.md)**.
Built by [**AZR Software Solutions**](https://azr.com.qa) — originally to render a 1080×1920
product promo from a Claude Design artifact, then generalized into a reusable tool.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Highlights](#highlights)
- [Capture modes](#capture-modes)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Usage & options](#usage--options)
- [Examples](#examples)
- [Add a music / audio track](#add-a-music--audio-track)
- [Poster frame / thumbnail](#poster-frame--thumbnail)
- [Use as a Claude skill](#use-as-a-claude-skill)
- [How it works](#how-it-works)
- [Output format](#output-format)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Project structure](#project-structure)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

---

## Why this exists

Claude can now **design animations in HTML** (the “Design” / Artifacts feature). They look
great in the browser — but to actually *use* one you almost always need an **MP4**: Reels,
TikTok, YouTube Shorts, LinkedIn, paid ads, a slide in a deck, a hero loop on a site.

Screen-recording is the obvious move and the wrong one: it drops frames under load, drifts
in timing, bakes in your monitor’s refresh rate, and is fiddly to crop to an exact size.

This tool instead **renders the page headless and captures one screenshot per output frame
at an exact timestamp**, then encodes the sequence with ffmpeg. The result is as smooth as
the fps you pick, at any resolution you pick, every single time.

## Highlights

- 🎯 **Frame-perfect for Claude Design artifacts.** Auto-detects the `*.dc.html` bundle,
  reads canvas size + duration from the export, and drives the engine’s own per-frame seek
  hook. Usually zero config — just point at the folder.
- 🧪 **Deterministic `--virtual` mode for *any* animation.** A virtual clock freezes
  `Date`/`performance.now`/`requestAnimationFrame`/timers **and** CSS/Web-Animations time,
  then steps it frame-by-frame — so hand-written canvas/WebGL/CSS loops capture
  frame-perfect too.
- 🎞️ **Any resolution / fps.** Vertical, square, landscape; 30 or 60 fps; optional `--scale 2`
  supersampling for razor-sharp text and edges.
- 🌐 **Real-time fallback** for maximum compatibility with unknown pages.
- 🔇→🎵 **Audio-ready.** Silent by design; one ffmpeg command muxes in a soundtrack.
- 🧩 **Drop-in Claude skill.** Install under `~/.claude/skills/` and Claude reaches for it
  whenever you ask to turn an animation into a video.
- 🪶 **Tiny + dependency-light.** One script, one npm dependency (Playwright) + system ffmpeg.

## Capture modes

The mode is chosen automatically; you can force one with a flag.

| Mode | Selected when | Determinism | Notes |
|---|---|---|---|
| **seek** | A Claude Design artifact is detected | Frame-perfect | Size + duration auto-detected; drives the engine’s seek hook |
| **virtual** (`--virtual`) | You opt in, on any page | Frame-perfect | Freezes & steps the page clock; covers JS **and** CSS animations (experimental) |
| **realtime** | Default for non-Design pages | Best-effort | Plays + captures at wall-clock fps; most compatible |

See [How it works](#how-it-works) for the details of each.

## Requirements

- **Node.js 18+**
- **Playwright + Chromium** — installed via `npm install` then `npx playwright install chromium`
- **ffmpeg** on your `PATH` — verify with `ffmpeg -version`
  - Windows: `winget install Gyan.FFmpeg` · macOS: `brew install ffmpeg` · Debian/Ubuntu: `sudo apt install ffmpeg`

## Installation

```bash
git clone https://github.com/AZR-Software-Solutions/html-animation-to-mp4
cd html-animation-to-mp4
npm install                       # installs Playwright
npx playwright install chromium   # one-time browser download
ffmpeg -version                   # confirm ffmpeg is available
```

## Quick start

```bash
# Claude Design artifact — point at the folder; size + duration auto-detect:
node scripts/render.mjs "path/to/My Animation" --fps 60

# A single entry .html (Design or generic):
node scripts/render.mjs path/to/promo.dc.html --out promo.mp4

# Generic HTML animation (best-effort real-time) — supply a duration:
node scripts/render.mjs ./banner --duration 8 --width 1080 --height 1080

# Generic HTML animation, frame-perfect:
node scripts/render.mjs ./banner --virtual --duration 8 --width 1080 --height 1080
```

Output defaults to `<input-dir>/<name>.mp4`.

## Usage & options

```
node scripts/render.mjs <input.html | dir> [options]
```

| Flag | Meaning | Default |
|---|---|---|
| `--out <file>` | Output MP4 path | `<input-dir>/<name>.mp4` |
| `--fps <n>` | Frames per second (60 = ultra-smooth) | `30` |
| `--duration <s>` | Length in seconds | auto (seek) / **required** (virtual & realtime) |
| `--width <px>` / `--height <px>` | Output pixels | auto (seek) / `1920×1080` (generic) |
| `--selector <css>` | Element to capture | Design canvas, else full page |
| `--scale <n>` | Supersample then downscale (crispness) | `1` (use `2` for extra sharp) |
| `--crf <n>` | x264 quality `0–51`, lower = better/bigger | `18` |
| `--bg <color>` | Background for transparent generic pages | `#000000` |
| `--virtual` | Deterministic virtual-clock capture (generic) | off |
| `--realtime` | Force best-effort real-time capture | off |
| `--keep-frames` | Keep the intermediate PNG frames | off |
| `--help` | Print usage | — |

The input can be a single `.html`/`.dc.html` file **or a folder** — for a folder it picks
`*.dc.html`, then `index*.html`, then the first `.html`.

## Examples

```bash
# Vertical promo (Reels / TikTok / Shorts), 60fps:
node scripts/render.mjs "marketing/My Promo" --fps 60

# Square cut for LinkedIn, extra-sharp via 2x supersample:
node scripts/render.mjs ./promo.dc.html --width 1080 --height 1080 --scale 2 --out promo-square.mp4

# A hand-written canvas / WebGL scene, frame-perfect, capture just one element:
node scripts/render.mjs ./scene.html --virtual --duration 6 --fps 60 --selector "#stage"

# Smaller file for email (higher CRF):
node scripts/render.mjs ./promo.dc.html --crf 24 --out promo-small.mp4
```

## Add a music / audio track

The capture is silent (frames only). Mux a soundtrack in afterward with ffmpeg:

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 -shortest out-with-audio.mp4
```

Fade the music out over the last 2 seconds of a 15s clip:

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 \
  -af "afade=t=out:st=13:d=2" -shortest out-with-audio.mp4
```

## Poster frame / thumbnail

```bash
ffmpeg -i out.mp4 -ss 2.0 -frames:v 1 poster.png        # grab a frame at t=2s
# or keep all PNGs from the run:
node scripts/render.mjs ./promo.dc.html --keep-frames
```

## Use as a Claude skill

Copy this folder into your Claude skills directory and Claude will use it automatically:

```bash
cp -r . ~/.claude/skills/html-animation-to-mp4
cd ~/.claude/skills/html-animation-to-mp4 && npm install
```

Then just ask:

> “turn this Claude design animation into an mp4”
> “export my HTML animation as a 60fps reel”
> “render `scene.html` to a 6-second square video”

The skill description ([`SKILL.md`](SKILL.md)) is tuned so Claude reaches for it on these
kinds of requests even when you don’t name a tool.

## How it works

Headless Chromium renders the page; the tool captures one screenshot **per output frame**,
then ffmpeg encodes the PNG sequence to H.264.

- **seek (Claude Design):** serve the bundle, read size/duration from the export-marked
  `<svg>`, pin it to its intrinsic size, then dispatch the engine’s
  `data-om-seek-to-time-frame` event to each exact time before each screenshot.
- **virtual (`--virtual`):** install a virtual clock *before* page scripts run, overriding
  `Date`/`performance.now`/`requestAnimationFrame`/timers and stepping
  `document.getAnimations()` time; advance it frame-by-frame.
- **realtime:** play the page and screenshot at wall-clock `1/fps`.

Full details — the seek protocol, the virtual-clock internals and caveats, encoding
settings, supersampling, and audio — are in
[`references/how-it-works.md`](references/how-it-works.md).

## Output format

- **Container/codec:** MP4 / H.264 (`libx264`), `-preset slow`
- **Pixel format:** `yuv420p` (plays everywhere — browsers, phones, social)
- **Quality:** CRF 18 by default (visually near-lossless); tune with `--crf`
- **Streaming:** `+faststart` (index at the front for instant web preview)
- **Audio:** none (add with the ffmpeg mux above)

## Troubleshooting & FAQ

- **Black or blank frames** — the page must be served over the local http server the script
  starts; don’t open `file://`. The script already waits for `document.fonts.ready`, images,
  and a settle delay.
- **Fonts render wrong** — Claude Design artifacts pull Google Fonts over the network; make
  sure the machine is online during capture.
- **`--virtual` makes a page look wrong** — some libraries start real-time timer chains at
  load that the virtual clock reorders. Use the default real-time mode for that page (Design
  artifacts are unaffected — they use seek mode).
- **`ffmpeg failed`** — install ffmpeg and confirm `ffmpeg -version` runs in the same shell.
- **`Cannot find package 'playwright'`** — run `npm install` in the folder you’re running the
  script from (Node resolves dependencies from there).
- **Is there audio?** — no; the capture is frame-only. See [Add a music / audio track](#add-a-music--audio-track).
- **Does it need a GPU / display?** — no; it runs fully headless.

## Project structure

```
html-animation-to-mp4/
├── SKILL.md                  # Claude skill definition (frontmatter + instructions)
├── scripts/
│   └── render.mjs            # the converter (CLI entry)
├── references/
│   └── how-it-works.md       # deep dive: modes, virtual clock, encoding, audio
├── package.json
├── README.md
└── LICENSE
```

## Contributing

Issues and PRs welcome. Good first contributions: a built-in `--audio <file>` flag, WebM/GIF
output, a `--poster <t>` thumbnail flag, and broadening `--virtual` coverage for exotic
timing libraries. Please keep the tool single-script and dependency-light.

## Roadmap

- [x] Frame-perfect Claude Design capture (seek hook)
- [x] Deterministic `--virtual` clock for generic JS/canvas/WebGL **and** CSS animations
- [ ] Built-in `--audio <file>` muxing (skip the manual ffmpeg step)
- [ ] WebM and animated-GIF output
- [ ] `--poster <t>` thumbnail export
- [ ] Optional transparent-background (`prores`/`webm` alpha) output

## License

[MIT](LICENSE) © AZR Software Solutions.
