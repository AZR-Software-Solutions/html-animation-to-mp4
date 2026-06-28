# html-animation-to-mp4

> Render an HTML/CSS/JS animation — especially a **Claude "Design" timeline artifact** —
> into a clean, shareable **MP4**, frame-perfect, via headless-browser capture + ffmpeg.

Built by [AZR Software Solutions](https://azr.com.qa). Ships both as a **CLI** and as a
**Claude skill** (`SKILL.md`). MIT-licensed.

## Why

Claude can now *design animations in HTML* (the "Design" / Artifacts feature). They look
great in the browser — but you usually need an **MP4** to actually post (Reels, TikTok,
Shorts, LinkedIn, ads, decks). Screen-recording is lossy and fiddly. This tool captures
**every frame at an exact timestamp** and encodes a real video, at any resolution/fps.

It was built to produce a 1080×1920 promo from a Claude Design artifact — frame-perfect,
60fps — and generalized so it works for any such artifact (and, best-effort, any HTML
animation).

## Features

- 🎯 **Deterministic** for Claude Design artifacts — drives the engine's own per-frame
  seek hook, so no dropped frames or jitter. Canvas size + duration **auto-detected**.
- 🖼️ **Any resolution / fps** — vertical, square, landscape; 30 or 60 fps; optional 2×
  supersampling for extra-sharp text.
- 🌐 **Generic fallback** — plays and captures any other HTML/CSS/JS animation (you give a
  duration).
- 🔇→🎵 **Audio-ready** — silent by design; one ffmpeg command muxes in a soundtrack.
- 🧩 **Drop-in Claude skill** — install under `~/.claude/skills/` and Claude will reach for
  it whenever you ask to turn an animation into a video.

## Install

```bash
git clone https://github.com/AZR-Software-Solutions/html-animation-to-mp4
cd html-animation-to-mp4
npm install                       # installs playwright
npx playwright install chromium   # one-time browser download
# ffmpeg must be on PATH:  ffmpeg -version
```

## Usage

```bash
# Claude Design artifact — point at the folder; size + duration auto-detect:
node scripts/render.mjs "path/to/My Animation" --fps 60

# A single entry .html:
node scripts/render.mjs path/to/promo.dc.html --out promo.mp4

# Generic HTML animation — supply a duration:
node scripts/render.mjs ./banner --duration 8 --width 1080 --height 1080
```

Common options: `--out`, `--fps`, `--duration`, `--width/--height`, `--selector`,
`--scale`, `--crf`, `--bg`, `--realtime`, `--keep-frames`. Run with `--help` for the full
list, or see [`SKILL.md`](SKILL.md).

### Add music

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 -shortest out-with-audio.mp4
```

## Use as a Claude skill

Copy this folder into your Claude skills directory:

```bash
cp -r . ~/.claude/skills/html-animation-to-mp4
```

Then just ask Claude things like *"turn this Claude design animation into an mp4"* or
*"export my HTML animation as a 60fps reel"* and it will run the converter.

## How it works

Headless Chromium renders the page; for Claude Design artifacts the script seeks the
timeline to each exact frame time and screenshots the canvas; ffmpeg encodes the PNG
sequence to H.264. Full details (the seek protocol, quality settings, the planned
deterministic virtual-clock for generic pages) are in
[`references/how-it-works.md`](references/how-it-works.md).

## Requirements

- Node 18+
- Playwright + Chromium (`npm i` then `npx playwright install chromium`)
- ffmpeg on PATH

## Roadmap

- Deterministic virtual-clock capture for generic (non-Design) JS/canvas/WebGL animations.
- Optional WebM/GIF output and built-in `--audio <file>` muxing.
- A poster-frame / thumbnail export flag.

## License

MIT © AZR Software Solutions. See [`LICENSE`](LICENSE).
