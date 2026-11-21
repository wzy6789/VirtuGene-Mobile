import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Sample the actual rendered backing, without crediting a text shadow or
// accidentally measuring the white glyph itself as part of its background.
const out = resolve('.tmp-preview/moments-living-mist-20261025');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const samples = [];
try {
  await page.goto('http://127.0.0.1:5572/?virtugene-preview=mobile');
  await page.waitForSelector('.vg-moment-card');
  await page.evaluate(() => { document.documentElement.dataset.vgReducedMotion = 'true'; });
  for (const width of [320, 360, 430]) for (const scrollTop of [0, 230, 530, 900]) {
    await page.setViewportSize({ width, height: 780 });
    await page.locator('.vg-moments-feed').evaluate((element, y) => { element.scrollTop = y; }, scrollTop);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].filter(image => { const r = image.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }).map(image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const boxes = await page.evaluate(() => {
      const feed = document.querySelector('.vg-moments-feed').getBoundingClientRect();
      const boxes = [];
      for (const element of document.querySelectorAll('.vg-moments-profile-row strong,.vg-moment-text,.vg-moment-comment-row,.vg-moment-comment-row strong,.vg-moment-meta span,.vg-moment-name,.vg-moment-more-comments')) {
        const range = document.createRange(); range.selectNodeContents(element);
        const rects = [...range.getClientRects()].filter(r => r.bottom > feed.top && r.top < feed.bottom).map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
        if (rects.length) boxes.push({ class: element.className || element.parentElement.className, color: getComputedStyle(element).color, rects });
      }
      const style = document.createElement('style'); style.id = 'moments-contrast-hide';
      style.textContent = '.vg-moment-body,.vg-moment-body *,.vg-moments-profile-row strong{color:transparent!important;text-shadow:none!important}';
      document.head.appendChild(style);
      return { boxes, clipTop: feed.top, clipBottom: feed.bottom };
    });
    const png = (await page.screenshot()).toString('base64');
    await page.evaluate(() => document.getElementById('moments-contrast-hide').remove());
    const readings = await page.evaluate(async ({ png, boxes, clipTop, clipBottom }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = rgb => {
        const v = rgb.map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
        return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
      };
      return boxes.map(box => {
        const fg = luminance(box.color.match(/[\d.]+/g).slice(0, 3).map(Number));
        let min = Infinity;
        for (const r of box.rects) for (let y = Math.max(Math.ceil(clipTop + 1), Math.ceil(r.y + 1)); y < Math.min(clipBottom - 1, r.y + r.height - 1); y += 2) {
          for (let x = Math.max(1, Math.ceil(r.x + 1)); x < Math.min(canvas.width - 1, r.x + r.width - 1); x += 2) {
            const i = (y * canvas.width + x) * 4;
            const bg = luminance([...pixels.slice(i, i + 3)]);
            min = Math.min(min, (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05));
          }
        }
        return { class: box.class, minRatio: Number.isFinite(min) ? +min.toFixed(2) : null };
      });
    }, { png, ...boxes });
    samples.push({ width, scrollTop, readings });
  }
  const failures = samples.flatMap(s => s.readings.filter(r => r.minRatio != null && r.minRatio < 4.5).map(r => ({ width: s.width, scrollTop: s.scrollTop, ...r })));
  const result = { scope: 'Desktop, 12 viewport/scroll combinations; actual background samples, not Android/accessibility certification', samples, failures, isolation: await page.evaluate(() => window.auditSilence) };
  await writeFile(resolve(out, 'reading-contrast-clear-optics-final.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ combinations: samples.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
