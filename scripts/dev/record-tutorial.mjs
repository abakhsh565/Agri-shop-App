#!/usr/bin/env node
/**
 * Turns the recorded step FRAMES into the shipped tutorial videos.
 *
 * Why this exists: this machine has no ffmpeg (not system-wide, and Playwright's bundled
 * copy cannot be downloaded here), so Playwright's own `video:` recording is unavailable.
 * Chrome ships its own VP8/VP9 encoder behind `MediaRecorder`, and a canvas is a legal
 * capture source, so the frames go: PNG → canvas → MediaRecorder → real `.webm`. No
 * external binary, no network, no third-party dependency.
 *
 * Input : `.freebuff/frames/<workflow>/NN.png` + `timeline.json` (written by
 *         `tests/media/capture.spec.ts`, which drives the REAL app in Urdu and burns the
 *         narration into each frame).
 * Output: `public/tutorials/<workflow>.webm` (silent, Urdu captions burned in) and
 *         `public/tutorials/<workflow>.png` (poster for the player).
 *
 * Usage: node scripts/dev/record-tutorial.mjs [workflow ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const FRAMES = '.freebuff/frames';
const OUT = 'public/tutorials';
const WIDTH = 390;
const HEIGHT = 844;
const FPS = 25;

const wanted = process.argv.slice(2);
const workflows = fs.existsSync(FRAMES)
  ? fs.readdirSync(FRAMES).filter((d) => {
    const dir = path.join(FRAMES, d);
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'timeline.json'))
      && (wanted.length === 0 || wanted.includes(d));
  })
  : [];

if (workflows.length === 0) {
  console.log('[tutorial] no recorded frames found — run the capture first:');
  console.log('  npx playwright test --config=playwright.media.config.ts tests/media/capture.spec.ts');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

let failures = 0;

for (const name of workflows) {
  const dir = path.join(FRAMES, name);
  const timeline = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));

  const frames = timeline.map((step) => ({
    dataUrl: `data:image/png;base64,${fs.readFileSync(path.join(dir, step.file)).toString('base64')}`,
    hold: step.hold,
  }));
  const totalMs = frames.reduce((sum, f) => sum + f.hold, 0);

  await page.goto('about:blank');
  const result = await page.evaluate(async ({ frames, width, height, fps }) => {
    // Decode every frame first, so the recording itself never waits on the disk.
    const images = [];
    for (const f of frames) {
      const img = new Image();
      img.src = f.dataUrl;
      await img.decode();
      images.push(img);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a09';
    ctx.fillRect(0, 0, width, height);

    const stream = canvas.captureStream(fps);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => window.MediaRecorder?.isTypeSupported?.(m)) ?? 'video/webm';
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000 });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(250);

    // Real-time paint: each frame is held for exactly the time its narration takes, which
    // is what makes the video match what the caption says.
    await new Promise((resolve) => {
      const t0 = performance.now();
      let i = 0;
      let elapsed = 0;
      const step = () => {
        const t = performance.now() - t0;
        while (i < images.length - 1 && t >= elapsed + frames[i].hold) {
          elapsed += frames[i].hold;
          i += 1;
          ctx.drawImage(images[i], 0, 0, width, height);
        }
        if (i >= images.length - 1 && t >= elapsed + frames[i].hold) return resolve();
        requestAnimationFrame(step);
      };
      ctx.drawImage(images[0], 0, 0, width, height);
      requestAnimationFrame(step);
    });

    // Hold the last frame for a beat so the video does not end mid-sentence.
    await new Promise((r) => setTimeout(r, 400));
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: mime });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 1) binary += String.fromCharCode(buffer[i]);
    return { mime, base64: btoa(binary) };
  }, { frames, width: WIDTH, height: HEIGHT, fps: FPS });

  const out = path.join(OUT, `${name}.webm`);
  fs.writeFileSync(out, Buffer.from(result.base64, 'base64'));

  // Poster: the first frame, so the player shows real UI before it is played.
  fs.copyFileSync(path.join(dir, timeline[0].file), path.join(OUT, `${name}.png`));

  const size = fs.statSync(out).size;
  const ok = size > 20_000;
  if (!ok) failures += 1;
  console.log(
    `[tutorial] ${ok ? '✓' : '✗'} ${name}: ${frames.length} frames · `
    + `${(totalMs / 1000).toFixed(1)}s · ${result.mime} · ${(size / 1024).toFixed(0)} KB`,
  );
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
