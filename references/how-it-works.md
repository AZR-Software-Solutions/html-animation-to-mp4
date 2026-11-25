# How it works

## The core idea: deterministic frame capture, not screen-recording

Screen-recording an animation captures whatever the display happened to paint in real
time — frames get dropped under load, timing drifts, and the result is only as good as
the monitor refresh. Instead, this tool renders the page in headless Chromium and
captures **one screenshot per output frame at a precise timestamp**, then hands the PNG
sequence to ffmpeg. Every frame is exact, so the video is as smooth as the chosen fps
allows, at any resolution.

There are three capture modes: **seek** (Claude Design), **virtual** (deterministic
generic), and **realtime** (best-effort generic).

## Mode 1 — seek: Claude Design timeline artifacts

A Claude "Design" animation exports as a bundle:

```
My Animation/
├── *.dc.html        # loader: <script src="support.js"> + <x-import ...>
├── support.js       # the Design runtime (React + JSX loader), self-contained
├── animations.jsx   # the timeline engine: Stage, useTime, Easing, interpolate, animate
├── <scene>.jsx      # your scene, rendered purely from useTime() (a time t in seconds)
└── assets/ uploads/ # images, logos, fonts referenced by the scene
```

The engine's `<Stage duration={…}>` renders the scene into an
`<svg data-om-exportable-video-with-duration-secs="…">` whose `width`/`height` attrs are
the canvas size. Crucially, the Stage listens for a custom event:

```js
// inside the engine (animations.jsx)
el.addEventListener("data-om-seek-to-time-frame", (e) => {
  setPlaying(false);
  setTime(clamp(e.detail.time, 0, duration));
});
```

So `render.mjs`:

1. Serves the bundle over `http://127.0.0.1` (relative `fetch()` of the `.jsx` files and
   assets needs a real origin — `file://` is blocked by CORS).
2. Reads `width`, `height`, and duration straight off the export-marked `<svg>` — **no
   manual config needed**.
3. Pins the canvas to its intrinsic size with `transform:none !important` (the Stage
   normally scales to fit the viewport) and hides the playback chrome, so each capture is
   exact and crisp.
4. For each frame `f`, dispatches `data-om-seek-to-time-frame` with `time = f/fps`, waits a
   double `requestAnimationFrame` for React to commit, and screenshots the `<svg>`.
5. Encodes with ffmpeg.

This is why Claude Design artifacts come out perfectly: the animation is a pure function
of `t`, and we control `t`.

## Mode 2 — virtual: a deterministic clock for generic animations (`--virtual`)

For an arbitrary page there's no seek hook, so we *create* one by freezing the page's
sense of time. Before any page script runs (Playwright `addInitScript`), we replace the
time primitives with virtual versions driven by a single controllable clock:

- `Date.now()` / `new Date()` → virtual time (with a fixed wall-clock origin).
- `performance.now()` → virtual milliseconds.
- `requestAnimationFrame` / `cancelAnimationFrame` → callbacks are queued, not run on the
  real vsync.
- `setTimeout` / `setInterval` / `clear*` → virtual timers fired when virtual time passes
  their deadline.

Then per output frame we call a control hook, `window.__vclock.goTo(ms)`, which:

1. Fires any due virtual timers in order (guarded against runaway intervals).
2. Sets `currentTime = ms` on every `document.getAnimations()` entry — this drives **CSS
   keyframe animations, CSS transitions, and Web-Animations-API** clips deterministically
   (they're on the compositor clock, which the JS overrides above don't touch).
3. Syncs `<video>`/`<audio>` `currentTime`.
4. Runs exactly one animation frame (the queued rAF callbacks); each callback typically
   draws and re-queues the next frame.

The result is frame-perfect capture for JS/canvas/WebGL loops *and* CSS animations.
Verified with a canvas+CSS test scene: at `t=0.2s` and `t=1.5s` the dot position, the
sliding CSS bar, and the on-screen timestamp all match exactly.

**Caveats (it's experimental):**
- Libraries that build state from *real* time at load (e.g. an `await setTimeout` chain
  during bootstrap) can be reordered by the virtual clock. If a page looks wrong under
  `--virtual`, use default real-time instead.
- WebGL/canvas that read time only from the rAF timestamp or `performance.now()` are
  covered; anything reading a clock we didn't override (rare) won't step.
- This is why it's opt-in: real-time is the most compatible default for unknown pages.

## Mode 3 — realtime: best-effort generic (default)

With no seek hook and no virtual clock, the script plays the page and captures at
wall-clock `1/fps` intervals. Works for most CSS/JS loops; not frame-perfect (screenshot
latency causes mild drift). Requires `--duration`.

## Encoding / quality

```
ffmpeg -y -framerate <fps> -i f_%06d.png \
  [-vf scale=W:H:flags=lanczos]        # only when --scale > 1 (supersample → downscale)
  -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow -movflags +faststart out.mp4
```

- **`-pix_fmt yuv420p`** — required for broad playback (browsers, phones, social).
- **`-crf 18`** — visually lossless-ish; lower = better/bigger, higher = smaller. Try 16
  for hero content, 20–23 for smaller files.
- **`-movflags +faststart`** — moves the index to the front so it streams/previews
  instantly on the web.
- **`--scale 2`** renders at 2× then downscales with Lanczos — extra-sharp text/edges at
  the cost of slower capture and bigger PNGs.

## Adding audio

Capture is silent. Mux a track afterward:

```bash
ffmpeg -i out.mp4 -i music.mp3 -c:v copy -map 0:v:0 -map 1:a:0 -shortest out-with-audio.mp4
```

Use `-af "afade=t=out:st=<dur-2>:d=2"` to fade the music out at the end.

## Choosing the browser binary

Playwright maps each of its releases to one pinned Chromium revision, resolved from its own
download cache (`%LOCALAPPDATA%\ms-playwright` on Windows, `~/Library/Caches/ms-playwright`
on macOS, `~/.cache/ms-playwright` on Linux). It does *not* fall back to a system Chrome, and
it rejects a cache entry built for a different revision — that is the
`Executable doesn't exist at …` error.

`--chrome <path>` (or `H2V_CHROME`) short-circuits that lookup: the path is resolved and
passed to `chromium.launch({ executablePath })`, so the renderer drives that binary instead.
Nothing else changes — viewport, `deviceScaleFactor` for `--scale`, the virtual clock and
the screenshot path all behave the same. A missing path fails fast with
`[h2v] --chrome not found: …` before the static server or any frame capture starts.

## Poster frame / thumbnail

Pass `--keep-frames` and grab any PNG from the temp frames dir, or extract straight from
the MP4:

```bash
ffmpeg -i out.mp4 -ss 2.0 -frames:v 1 poster.png
```
