#!/usr/bin/env node
/**
 * render.mjs — HTML/CSS/JS animation -> MP4 via headless Chromium frame capture + ffmpeg.
 *
 * FLAGSHIP PATH — Claude "Design" timeline artifacts (a *.dc.html bundle that loads
 * the Design animation engine). These expose a deterministic seek hook, so every
 * frame is rendered at an EXACT timestamp: no real-time jitter, no dropped frames,
 * and the canvas size + duration are auto-detected. This is why the output is
 * smoother and crisper than screen-recording.
 *
 * FALLBACK PATH — any other HTML animation is captured best-effort in real time
 * (you supply --duration; --width/--height default to 1920x1080).
 *
 * Requires: `playwright` (run `npx playwright install chromium` once) and `ffmpeg` on PATH.
 *
 * Usage:  node render.mjs <input.html | dir> [options]
 *   --out <file>      output .mp4 (default: <input-dir>/<name>.mp4)
 *   --fps <n>         frames/sec (default 30)
 *   --duration <s>    seconds (auto-detected for Claude Design; REQUIRED otherwise)
 *   --width <px>      (auto for Claude Design; default 1920 generic)
 *   --height <px>     (auto for Claude Design; default 1080 generic)
 *   --selector <css>  element to capture (default: the Design canvas, else full page)
 *   --scale <n>       supersample factor for extra crispness (default 1; e.g. 2 = render 2x then downscale)
 *   --crf <n>         x264 quality 0-51, lower=better (default 18)
 *   --bg <color>      background for transparent generic pages (default #000000)
 *   --realtime        force real-time capture even for a Claude Design artifact
 *   --keep-frames     keep the intermediate PNG frames
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
  --fps <n>         frames/sec (default 30)
  --duration <s>    seconds (auto-detected for Claude Design; required otherwise)
  --width/--height  pixels (auto for Claude Design; default 1920x1080)
  --selector <css>  element to capture (default: the Design canvas, else full page)
  --scale <n>       supersample factor (default 1)
  --crf <n>         x264 quality, lower=better (default 18)
  --bg <color>      background for transparent pages (default #000000)
  --realtime        force real-time capture
  --keep-frames     keep PNG frames`);
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

// ---- launch + detect mode ----
const DC = "svg[data-om-exportable-video-with-duration-secs]";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});

const isDC = !opts.realtime && (await page.$(DC));
let width, height, duration, selector, mode;
if (isDC) {
  mode = "claude-design (deterministic seek)";
  const info = await page.$eval(DC, (el) => ({
    w: +el.getAttribute("width"), h: +el.getAttribute("height"),
    d: +el.getAttribute("data-om-exportable-video-with-duration-secs"),
  }));
  width = +opts.width || info.w; height = +opts.height || info.h;
  duration = +opts.duration || info.d; selector = (opts.selector && opts.selector !== "true") ? opts.selector : DC;
  await page.setViewportSize({ width: width + 40, height: height + 80 });
  // Pin the canvas to its intrinsic size (defeat the engine's fit-to-viewport
  // scale) and hide the playback chrome so each capture is exact + crisp.
  await page.addStyleTag({ content: `${DC}{transform:none !important;} [data-omelette-chrome]{display:none !important;}` });
} else {
  mode = "generic (real-time)";
  width = +opts.width || 1920; height = +opts.height || 1080;
  duration = +opts.duration;
  if (!duration) { console.error("Generic HTML animation: --duration <seconds> is required (only Claude Design artifacts auto-detect it)."); await browser.close(); server.close(); process.exit(1); }
  selector = (opts.selector && opts.selector !== "true") ? opts.selector : null;
  await page.setViewportSize({ width, height });
  await page.addStyleTag({ content: `html,body{background:${bg} !important;}` }).catch(() => {});
}

// Let fonts + images + first paint settle before capturing.
await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))))).catch(() => {});
await page.waitForTimeout(1200);

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
const targetHandle = selector ? await page.$(selector) : null;
const shoot = (file) => (targetHandle ? targetHandle.screenshot({ path: file }) : page.screenshot({ path: file }));

const total = Math.round(fps * duration);
console.log(`[h2v] mode=${mode}  ${width}x${height}  ${duration}s @ ${fps}fps  -> ${total + 1} frames (scale ${scale})`);

for (let f = 0; f <= total; f++) {
  const t = Math.min(duration, f / fps);
  if (isDC) {
    // Drive the engine's own export hook to the exact timestamp, then let React
    // commit the render (double rAF) before capturing — fully deterministic.
    await page.evaluate(({ s, tt }) => {
      document.querySelector(s).dispatchEvent(new CustomEvent("data-om-seek-to-time-frame", { detail: { time: tt } }));
    }, { s: DC, tt: t });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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
