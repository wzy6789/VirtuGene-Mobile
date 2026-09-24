#!/usr/bin/env node
/** 从当前源码构建并发布 Android release APK 到 Gitee。 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REPO = 'wang-zhiyi6789/virtu-gene';
const API = `https://gitee.com/api/v5/repos/${REPO}`;
const APK_PATH = resolve(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
const version = process.argv[2]?.replace(/^v/i, '');
const token = process.env.GITEE_TOKEN || readStoredToken();

function readStoredToken() {
  try {
    const credentials = execFileSync('git', ['-c', 'credential.interactive=never', 'credential', 'fill'], {
      input: 'protocol=https\nhost=gitee.com\nusername=wang-zhiyi6789\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return credentials.match(/^password=(.+)$/m)?.[1]?.trim();
  } catch {
    return null;
  }
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('用法: node scripts/gitee-release.mjs 5.2.1');
}
if (!token) throw new Error('请先把 Gitee 私人令牌存入本机 Git 凭据管理器，或设置 GITEE_TOKEN');
const packageVersion = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version;
if (version !== packageVersion) throw new Error(`版本不一致：参数 ${version}，package.json ${packageVersion}`);
const gradleFile = readFileSync(resolve(ROOT, 'android/app/build.gradle'), 'utf8');
if (!gradleFile.includes(`versionName "${version}"`)) {
  throw new Error(`android/app/build.gradle 的 versionName 与 ${version} 不一致`);
}

const tag = `v${version}`;
const existing = await fetch(`${API}/releases/tags/${tag}`);
const existingRelease = existing.ok ? await existing.json() : null;
// Gitee 对「只有 Git 标签、尚无发行版」会返回 HTTP 200 + JSON null。
if (!existing.ok && existing.status !== 404) throw new Error(`检查发行版失败：HTTP ${existing.status}`);
if (existingRelease?.assets?.some((asset) => /\.apk$/i.test(asset.name ?? ''))) {
  throw new Error(`${tag} 已有 APK；版本不可覆盖，请递增版本重新发布`);
}

console.log(`构建 Android ${tag}...`);
execFileSync(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
});
execFileSync(process.execPath, [resolve(ROOT, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], {
  cwd: ROOT,
  stdio: 'inherit',
});
const gradleEnv = { ...process.env };
delete gradleEnv.GRADLE_USER_HOME;
const gradleArgs = process.env.VIRTUGENE_GRADLE_ONLINE === '1' ? '' : ' --offline';
execFileSync('cmd.exe', ['/d', '/s', '/c', `gradlew.bat assembleRelease${gradleArgs}`], {
  cwd: resolve(ROOT, 'android'),
  env: gradleEnv,
  stdio: 'inherit',
});
if (!statSync(APK_PATH, { throwIfNoEntry: false })) throw new Error(`构建后找不到 APK：${APK_PATH}`);

const apk = readFileSync(APK_PATH);
const sha256 = createHash('sha256').update(apk).digest('hex');
const body = [
  `VirtuGene Android ${tag}`,
  '',
  'SHA-256 (app-release.apk):',
  sha256,
].join('\n');
let release = existingRelease;
if (!release?.id) {
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
  release = await created.json();
  if (!created.ok || !release?.id) {
    throw new Error(`创建 Gitee 发行版失败：HTTP ${created.status} ${JSON.stringify(release).slice(0, 300)}`);
  }
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
