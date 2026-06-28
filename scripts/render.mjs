#!/usr/bin/env node
/**
 * render.mjs — HTML/CSS/JS animation -> MP4 via headless Chromium frame capture + ffmpeg.
 *
 * Three capture modes (auto-selected, or forced with a flag):
 *
 *  • seek      (Claude "Design" timeline artifacts, auto-detected) — the Design engine
 *              exposes a per-frame seek hook (`data-om-seek-to-time-frame`); we drive the
 *              playhead to each exact timestamp. Canvas size + duration auto-detected.
 *              Frame-perfect.
 *  • virtual   (--virtual) — a deterministic virtual clock: Date/performance/rAF/timers and
 *              CSS-WAAPI animation time are frozen and stepped frame-by-frame, so generic
 *              JS/canvas/WebGL/CSS animations capture frame-perfect too (experimental).
 *  • realtime  (default for non-Design pages) — plays the page and captures best-effort at
 *              wall-clock 1/fps. Most compatible; mild timing drift.
 *
 * Requires: `playwright` (run `npx playwright install chromium` once) and `ffmpeg` on PATH.
 *
 * Usage:  node render.mjs <input.html | dir> [options]   (see --help)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---- args ----
const raw = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    opts[k] = raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : "true";
  } else positional.push(a);
}
const input = positional[0];
if (!input || opts.help) {
  console.log(`html-animation-to-mp4 — render an HTML animation to MP4

usage: node render.mjs <input.html | dir> [options]
  --out <file>      output .mp4 (default: <input-dir>/<name>.mp4)
  --fps <n>         frames/sec (default 30; try 60 for ultra-smooth)
  --duration <s>    seconds (auto-detected for Claude Design; required otherwise)
  --width/--height  pixels (auto for Claude Design; default 1920x1080)
  --selector <css>  element to capture (default: the Design canvas, else full page)
  --scale <n>       supersample factor (default 1; 2 = render 2x then downscale, crisper)
  --crf <n>         x264 quality 0-51, lower=better (default 18)
  --bg <color>      background for transparent pages (default #000000)
  --virtual         deterministic virtual-clock capture for generic animations (experimental)
  --realtime        force best-effort real-time capture
  --keep-frames     keep the intermediate PNG frames

modes: Claude Design artifacts auto-use a frame-perfect seek hook. For other pages,
       default is real-time; add --virtual for deterministic JS/canvas/CSS capture.`);
  process.exit(input ? 0 : 1);
}

// ---- resolve input: a file, or a dir (pick *.dc.html > index*.html > first .html) ----
const ABS = path.resolve(input);
let serveDir, entryFile;
if (fs.statSync(ABS).isDirectory()) {
  serveDir = ABS;
  const htmls = fs.readdirSync(ABS).filter((f) => f.toLowerCase().endsWith(".html"));
  entryFile = htmls.find((f) => f.toLowerCase().endsWith(".dc.html"))
    || htmls.find((f) => /index/i.test(f)) || htmls[0];
  if (!entryFile) { console.error("No .html file found in", ABS); process.exit(1); }
} else {
  serveDir = path.dirname(ABS);
  entryFile = path.basename(ABS);
}

const fps = +opts.fps || 30;
const scale = Math.max(1, +opts.scale || 1);
const crf = opts.crf && opts.crf !== "true" ? String(opts.crf) : "18";
const bg = opts.bg && opts.bg !== "true" ? opts.bg : "#000000";
const forceRealtime = !!opts.realtime;
const forceVirtual = !!opts.virtual && !forceRealtime;
const outFile = opts.out && opts.out !== "true"
  ? path.resolve(opts.out)
  : path.join(serveDir, entryFile.replace(/\.(dc\.)?html?$/i, "") + ".mp4");
const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "h2v-frames-"));

// ---- static server (relative fetches + CORS need http, not file://) ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/") p = "/" + entryFile;
  const fp = path.join(serveDir, p);
  if (!fp.startsWith(serveDir)) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (e, buf) => {
    if (e) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(fp).toLowerCase()] || "application/octet-stream", "access-control-allow-origin": "*" });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(entryFile)}`;
console.log(`[h2v] serving ${serveDir}\n[h2v] open   ${url}`);

// ---- deterministic virtual clock (installed before page scripts when --virtual) ----
// Freezes the page's sense of time so we can step it frame-by-frame. Covers rAF, Date,
// performance.now, setTimeout/setInterval, CSS+WAAPI animation time (getAnimations), and
// media currentTime. Experimental: load-time setTimeout chains and exotic timing libs may
// behave differently — fall back to --realtime if a page misbehaves.
function VCLOCK_INIT() {
  const OrigDate = Date;
  const startWall = OrigDate.now();
  let now = 0;            // virtual milliseconds
  let rafQueue = [];
  let rafSeq = 1;
  const timers = [];
  let timerSeq = 1;

  function VDate(...a) { return a.length ? new OrigDate(...a) : new OrigDate(startWall + now); }
  VDate.now = () => startWall + now;
  VDate.UTC = OrigDate.UTC;
  VDate.parse = OrigDate.parse;
  VDate.prototype = OrigDate.prototype;
  window.Date = VDate;

  performance.now = () => now;

  window.requestAnimationFrame = (cb) => { const id = rafSeq++; rafQueue.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { rafQueue = rafQueue.filter(([i]) => i !== id); };

  window.setTimeout = (fn, d, ...a) => { const id = timerSeq++; timers.push({ id, fn, a, at: now + (+d || 0), every: 0 }); return id; };
  window.setInterval = (fn, d, ...a) => { const id = timerSeq++; timers.push({ id, fn, a, at: now + (+d || 0), every: Math.max(1, +d || 1) }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); };

  window.__vclock = {
    goTo(ms) {
      // Fire due timers in order up to `ms` (guard against runaway intervals).
      let guard = 0;
      for (;;) {
        const next = timers.filter((t) => t.at <= ms).sort((a, b) => a.at - b.at)[0];
        if (!next || guard++ > 20000) break;
        now = next.at;
        try { next.fn.apply(null, next.a || []); } catch (e) { /* swallow */ }
        if (next.every) next.at += next.every;
        else { const i = timers.indexOf(next); if (i >= 0) timers.splice(i, 1); }
      }
      now = ms;
      // Drive CSS / Web-Animations-API time deterministically.
      try { document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = ms; } catch (e) { /**/ } }); } catch (e) { /**/ }
      // Sync media elements.
      try { document.querySelectorAll("video,audio").forEach((v) => { try { v.pause(); v.currentTime = ms / 1000; } catch (e) { /**/ } }); } catch (e) { /**/ }
      // Run exactly one animation frame; callbacks re-queue the next one.
      const q = rafQueue; rafQueue = [];
      q.forEach(([, cb]) => { try { cb(now); } catch (e) { /**/ } });
    },
  };
}

// ---- launch ----
const DC = "svg[data-om-exportable-video-with-duration-secs]";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
if (forceVirtual) await page.addInitScript(VCLOCK_INIT); // must be installed before page scripts run
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});

// ---- choose mode ----
let mode;
if (forceRealtime) mode = "realtime";
else if (forceVirtual) mode = "virtual";
else if (await page.$(DC)) mode = "seek";
else mode = "realtime";

let width, height, duration, selector;
if (mode === "seek") {
  const info = await page.$eval(DC, (el) => ({
    w: +el.getAttribute("width"), h: +el.getAttribute("height"),
    d: +el.getAttribute("data-om-exportable-video-with-duration-secs"),
  }));
  width = +opts.width || info.w; height = +opts.height || info.h;
  duration = +opts.duration || info.d; selector = (opts.selector && opts.selector !== "true") ? opts.selector : DC;
  await page.setViewportSize({ width: width + 40, height: height + 80 });
  await page.addStyleTag({ content: `${DC}{transform:none !important;} [data-omelette-chrome]{display:none !important;}` });
} else {
  width = +opts.width || 1920; height = +opts.height || 1080;
  duration = +opts.duration;
  if (!duration) { console.error("This page isn't a Claude Design artifact, so --duration <seconds> is required."); await browser.close(); server.close(); process.exit(1); }
  selector = (opts.selector && opts.selector !== "true") ? opts.selector : null;
  await page.setViewportSize({ width, height });
  await page.addStyleTag({ content: `html,body{background:${bg} !important;}` }).catch(() => {});
}

// Let fonts + images + first paint settle.
await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))))).catch(() => {});
await page.waitForTimeout(1200);
if (mode === "virtual") await page.evaluate(() => window.__vclock.goTo(0)).catch(() => {}); // settle t=0

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const targetHandle = selector ? await page.$(selector) : null;
const shoot = (file) => (targetHandle ? targetHandle.screenshot({ path: file }) : page.screenshot({ path: file }));

const total = Math.round(fps * duration);
console.log(`[h2v] mode=${mode}  ${width}x${height}  ${duration}s @ ${fps}fps  -> ${total + 1} frames (scale ${scale})`);

for (let f = 0; f <= total; f++) {
  const t = Math.min(duration, f / fps);
  if (mode === "seek") {
    await page.evaluate(({ s, tt }) => {
      document.querySelector(s).dispatchEvent(new CustomEvent("data-om-seek-to-time-frame", { detail: { time: tt } }));
    }, { s: DC, tt: t });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  } else if (mode === "virtual") {
    await page.evaluate((ms) => window.__vclock.goTo(ms), t * 1000);
    await page.waitForTimeout(4); // let the browser paint the stepped state (real wait; virtual clock is frozen)
  } else {
    await page.waitForTimeout(Math.max(0, 1000 / fps - 8)); // best-effort real-time pacing
  }
  await shoot(path.join(framesDir, `f_${String(f).padStart(6, "0")}.png`));
  if (f % Math.max(1, Math.round(fps)) === 0) console.log(`[h2v] frame ${f}/${total} (t=${t.toFixed(2)}s)`);
}
await browser.close();
server.close();

// ---- encode ----
const vf = scale > 1 ? ["-vf", `scale=${width}:${height}:flags=lanczos`] : [];
const ff = ["-y", "-framerate", String(fps), "-i", path.join(framesDir, "f_%06d.png"),
  ...vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", crf, "-preset", "slow",
  "-movflags", "+faststart", outFile];
console.log(`[h2v] ffmpeg encoding -> ${outFile}`);
const r = spawnSync("ffmpeg", ff, { stdio: ["ignore", "ignore", "inherit"] });
if (r.status !== 0) { console.error("[h2v] ffmpeg failed — is ffmpeg installed and on PATH?"); process.exit(1); }
if (!opts["keep-frames"]) fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`[h2v] DONE -> ${outFile}`);
