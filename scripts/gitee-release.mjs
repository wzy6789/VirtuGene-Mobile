#!/usr/bin/env node
/** 发布已构建并验收的 Android release APK 到 Gitee。 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = 'wang-zhiyi6789/virtu-gene';
const API = `https://gitee.com/api/v5/repos/${REPO}`;
const APK_PATH = resolve(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const version = process.argv[2]?.replace(/^v/i, '');
const token = process.env.GITEE_TOKEN;

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('用法: node scripts/gitee-release.mjs 5.2.1');
}
if (!token) throw new Error('请先在本机环境变量 GITEE_TOKEN 中设置 Gitee 私人令牌');
const packageVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
if (version !== packageVersion) throw new Error(`版本不一致：参数 ${version}，package.json ${packageVersion}`);
if (!statSync(APK_PATH, { throwIfNoEntry: false })) throw new Error(`找不到 release APK：${APK_PATH}`);

const tag = `v${version}`;
const existing = await fetch(`${API}/releases/tags/${tag}`);
if (existing.ok) throw new Error(`${tag} 已存在；版本不可覆盖，请递增版本重新发布`);
if (existing.status !== 404) throw new Error(`检查发行版失败：HTTP ${existing.status}`);

const apk = readFileSync(APK_PATH);
const sha256 = createHash('sha256').update(apk).digest('hex');
const body = [
  `VirtuGene Android ${tag}`,
  '',
  'SHA-256 (app-release.apk):',
  sha256,
].join('\n');
const releaseForm = new URLSearchParams({
  access_token: token,
  tag_name: tag,
  name: `VirtuGene ${tag}`,
  body,
  target_commitish: 'main',
});
const created = await fetch(`${API}/releases`, {
  method: 'POST',
  body: releaseForm,
});
const release = await created.json();
if (!created.ok || !release.id) {
  throw new Error(`创建 Gitee 发行版失败：HTTP ${created.status} ${JSON.stringify(release).slice(0, 300)}`);
}

const uploadForm = new FormData();
uploadForm.append('access_token', token);
uploadForm.append('file', new Blob([apk], { type: 'application/vnd.android.package-archive' }), 'app-release.apk');
const uploaded = await fetch(`${API}/releases/${release.id}/attach_files`, {
  method: 'POST',
  body: uploadForm,
});
const attachment = await uploaded.json();
if (!uploaded.ok || !attachment.browser_download_url) {
  throw new Error(`发行版已建立，但 APK 上传失败：HTTP ${uploaded.status} ${JSON.stringify(attachment).slice(0, 300)}`);
}
console.log(`发布完成：${tag}`);
console.log(`下载：${attachment.browser_download_url}`);
console.log(`SHA-256：${sha256}`);
