# How it works

## The core idea: deterministic frame capture, not screen-recording

Screen-recording an animation captures whatever the display happened to paint in real
time — frames get dropped under load, timing drifts, and the result is only as good as
the monitor refresh. Instead, this tool renders the page in headless Chromium and
captures **one screenshot per output frame at a precise timestamp**, then hands the PNG
sequence to ffmpeg. Every frame is exact, so the video is as smooth as the chosen fps
allows, at any resolution.

## Claude Design timeline artifacts (the deterministic path)

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

## Generic HTML animations (the real-time fallback)

For any other animated page there's no seek hook, so the script plays it and captures at
wall-clock `1/fps` intervals. This works for CSS/JS animations and loops but isn't
frame-perfect (screenshot latency causes mild drift), and you must pass `--duration`.

**Planned enhancement — deterministic virtual clock:** override `Date.now`,
`performance.now`, `requestAnimationFrame`, and timers via an init script so the page's
own clock can be stepped frame-by-frame (the "timecut/timesnap" technique). This makes
JS/canvas/WebGL animations frame-perfect too. Caveat: CSS keyframe/transition animations
are driven by the compositor's clock and won't respect a mocked clock, so they'd still
need real-time capture. Contributions welcome.

## Encoding / quality

ffmpeg settings used:

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
