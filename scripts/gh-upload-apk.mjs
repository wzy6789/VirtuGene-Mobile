#!/usr/bin/env node
/**
 * 重新上传 APK 到指定 release（覆盖场景用：先删旧资产，再传新 APK）。
 * 用法: node scripts/gh-upload-apk.mjs <releaseId>
 */
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const APK_PATH = resolve(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const releaseId = process.argv[2];
const repo = 'wzy6789/VirtuGene-Mobile';

function getToken() {
  const t = process.env.GITHUB_TOKEN;
  if (t) return t;
  const input = 'protocol=https\nhost=github.com\n\n';
  const out = execSync('git credential fill', { input, encoding: 'utf8' });
  const m = out.match(/^password=(.+)$/m);
  return m ? m[1].trim() : null;
}

const token = getToken();
if (!releaseId) { console.error('❌ 用法: node scripts/gh-upload-apk.mjs <releaseId>'); process.exit(1); }
if (!token) { console.error('❌ 无 token'); process.exit(1); }
if (!statSync(APK_PATH, { throwIfNoEntry: false })) { console.error('❌ 无 APK'); process.exit(1); }

const size = statSync(APK_PATH).size;
console.log(`⬆️ 上传 APK(${(size / 1048576).toFixed(1)}MB) → release ${releaseId} …`);

const url = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=app-debug.apk`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': String(size),
  },
  body: createReadStream(APK_PATH),
  duplex: 'half',
});
const body = await res.json();
if (!res.ok) {
  console.error(`❌ 上传失败: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  process.exit(1);
}
console.log(`✅ 上传完成: ${body.name} (${(body.size / 1048576).toFixed(1)}MB)`);
console.log(`   ${body.browser_download_url}`);
