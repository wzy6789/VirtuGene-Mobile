// Local-only visual timing helper. No network, model calls, or phone controls.
// Screenshots contain private UI: remove generated images after extracting timings.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(join(dirname(process.execPath), 'package.json'))('playwright');
const videoPath = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const step = Number(process.argv[4] ?? 2);
const start = Number(process.argv[5] ?? 0);
const end = Number(process.argv[6] ?? 25);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1600 } });
  await page.route('**/*', route => route.abort());
  await page.setContent('<video id="v" muted preload="auto"></video>');
  await page.evaluate(base64 => {
    const data = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    document.getElementById('v').src = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
  }, readFileSync(videoPath).toString('base64'));
  const result = await page.evaluate(async ({ step, start, end }) => {
    const video = document.getElementById('v');
    if (video.readyState < 1) await new Promise((r, j) => { video.onloadedmetadata = r; video.onerror = j; });
    const times = [];
    for (let t = start; t < Math.min(end, video.duration); t += step) times.push(t);
    const columns = 4, w = 250, h = 570;
    const sheet = document.createElement('canvas');
    sheet.width = columns * w; sheet.height = Math.ceil(times.length / columns) * h;
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    const decodedFrames = [];
    for (let i = 0; i < times.length; i++) {
      const t = Math.max(.001, times[i]);
      const frame = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No decoded frame for seek ' + t)), 5000);
        video.requestVideoFrameCallback((_, metadata) => { clearTimeout(timer); resolve(metadata); });
        video.currentTime = t;
      });
      decodedFrames.push({ requested: t, mediaTime: frame.mediaTime, presentedFrames: frame.presentedFrames });
      const x = (i % columns) * w, y = Math.floor(i / columns) * h;
      ctx.drawImage(video, x, y + 24, w, 546);
      ctx.fillStyle = '#000'; ctx.font = '18px sans-serif'; ctx.fillText(times[i].toFixed(2) + 's', x + 4, y + 20);
    }
    return { duration: video.duration, times, decodedFrames, image: sheet.toDataURL('image/png').split(',')[1] };
  }, { step, start, end });
  writeFileSync(output, Buffer.from(result.image, 'base64'));
  console.log(JSON.stringify({ duration: result.duration, frames: result.decodedFrames, output }));
} finally { await browser.close(); }
