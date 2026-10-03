// Export generated originals as WebP assets without changing framing or dimensions.
// The PNG originals remain available for future art revisions.
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const { chromium } = createRequire(path.join(path.dirname(process.execPath), 'package.json'))('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const directory = path.resolve(__dirname, '../src/assets/secretary');
    for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.png'))) {
      const target = path.join(directory, name.replace(/\.png$/, '.webp'));
      if (fs.existsSync(target)) continue;
      const original = fs.readFileSync(path.join(directory, name));
      const encoded = await page.evaluate(async data => {
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        canvas.getContext('2d').drawImage(image, 0, 0);
        return canvas.toDataURL('image/webp', 0.92);
      }, 'data:image/png;base64,' + original.toString('base64'));
      if (!encoded.startsWith('data:image/webp;base64,')) throw new Error('WebP export unavailable');
      const bytes = Buffer.from(encoded.split(',')[1], 'base64');
      fs.writeFileSync(target, bytes, { flag: 'wx' });
      console.log(name + ': ' + original.length + ' -> ' + bytes.length + ' bytes');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
