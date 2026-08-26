#!/usr/bin/env node
/**
 * GitHub Releases 发布脚本（手机端 APK 自动更新）。
 *
 * 用法（在项目根目录，需要先创建 GitHub 仓库并设置 token）：
 *   1. 创建仓库（如你的账号/VirtuGene-Mobile），并填 src/lib/update-config.ts 里的 GITHUB_REPO
 *   2. 生成 GitHub Personal Access Token（Settings → Developer settings → Tokens，
 *      勾选 repo 权限），设置环境变量：
 *        $env:GITHUB_TOKEN = "ghp_xxx"
 *   3. 发布新版本：
 *        node scripts/gh-release.mjs 2.0.3   # 版本号
 *
 * 说明：
 *   - 自动执行 mobile:build 构建 debug APK
 *   - 用 GitHub API 创建 Release（tag: v{version}）并上传 APK
 *   - 之后手机端「我的 → 版本」点检查更新即可发现并下载
 */
import { execSync } from 'node:child_process';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const APK_PATH = resolve(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');

// 从 update-config.ts 读仓库（避免两处维护）
const configSrc = readConfig();
const repo = configSrc.GITHUB_REPO;

const version = process.argv[2];
const token = process.env.GITHUB_TOKEN;

function readConfig() {
  const src = require('node:fs').readFileSync(resolve(ROOT, 'src/lib/update-config.ts'), 'utf-8');
  const m = src.match(/GITHUB_REPO\s*=\s*'([^']+)'/);
  return { GITHUB_REPO: m ? m[1] : 'YOUR_GITHUB_USERNAME/VirtuGene-Mobile' };
}

if (!version) {
  console.error('❌ 用法: node scripts/gh-release.mjs <版本号>  例: node scripts/gh-release.mjs 2.0.3');
  process.exit(1);
}
if (!token) {
  console.error('❌ 未设置 GITHUB_TOKEN 环境变量（GitHub Settings → Developer settings → Personal access tokens，勾选 repo 权限）');
  process.exit(1);
}
if (!repo || repo.startsWith('YOUR_')) {
  console.error(`❌ 请先在 src/lib/update-config.ts 填写 GITHUB_REPO（当前: "${repo}"）`);
  process.exit(1);
}

console.log(`📦 发布 VirtuGene v${version} → GitHub ${repo}`);

// 1. 构建 APK
console.log('🔨 构建 APK…');
try {
  execSync('npm run mobile:build', { cwd: ROOT, stdio: 'inherit' });
} catch {
  console.error('❌ 构建失败');
  process.exit(1);
}
if (!statSync(APK_PATH, { throwIfNoEntry: false })) {
  console.error(`❌ 未找到 APK: ${APK_PATH}`);
  process.exit(1);
}
const apkSize = (statSync(APK_PATH).size / 1024 / 1024).toFixed(1);

// 2. 创建 Release
console.log(`⬆️ 创建 Release v${version} …`);
const tag = `v${version}`;
const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
  method: 'POST',
  headers: {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    tag_name: tag,
    name: `VirtuGene v${version}`,
    body: `VirtuGene 手机版 v${version} 自动更新发布\n\n在 App 内「我的 → 版本」检查更新即可下载。`,
    draft: false,
    prerelease: false,
  }),
});
const release = await createRes.json();
if (!createRes.ok) {
  // 已存在该 tag → 尝试用现有 release
  if (createRes.status === 422) {
    const getRes = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
    });
    const existing = await getRes.json();
    if (existing.id) {
      console.log(`ℹ️ Release v${version} 已存在，直接上传 APK`);
      await uploadApk(existing.id, token, repo);
      console.log(`✅ 完成！APK(${apkSize}MB) 已上传到 ${tag}`);
      return;
    }
  }
  console.error(`❌ 创建 Release 失败: ${createRes.status} ${JSON.stringify(release)}`);
  process.exit(1);
}
await uploadApk(release.id, token, repo);
console.log(`✅ 完成！Release ${tag} + APK(${apkSize}MB) 已发布`);
console.log(`   🔗 https://github.com/${repo}/releases/tag/${tag}`);
console.log(`   手机端「我的 → 版本」检查更新即可下载。`);

/** 上传 APK 到 release 资产 */
async function uploadApk(releaseId: number, token: string, repo: string) {
  const size = statSync(APK_PATH).size;
  const url = `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=app-debug.apk`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(size),
    },
    body: createReadStream(APK_PATH) as unknown as BodyInit,
    duplex: 'half',
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`上传 APK 失败: ${res.status} ${body.slice(0, 200)}`);
  }
}
