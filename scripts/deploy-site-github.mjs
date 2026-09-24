#!/usr/bin/env node
/**
 * 把 `website/` 的内容作为一个提交推到 GitHub 仓库默认分支，用来触发 GitHub Pages 部署。
 *
 * ## 为什么不用 `git push`
 * 本机到 GitHub 的 git 通道目前不通：
 * - HTTPS（schannel / openssl 两种后端都试过）握手被切：`failed to receive handshake`；
 * - `~/.ssh/config` 里 github 走本地代理 `connect -H 127.0.0.1:7897`，代理在跑但连接被关；
 *   直连 `ssh.github.com:443` 则是 `Permission denied (publickey)`（本机 key 未加到 GitHub）。
 * 而 Node 的 fetch 走 IPv4 是通的，所以这里改用 Git Data API（blob → tree → commit → ref）。
 *
 * ## 注意
 * - **代码主仓库在 GitHub**；本脚本只同步 `website/**`，应用代码通过正常 Git 提交推送，
 *   不会把 `src/`、`android/`、`docs/` 同步过去（那边的代码会停在最后一次全量推送的版本）。
 * - 只更新与远端不一致的文件（按 git blob 哈希比较），不会制造无意义的提交；
 *   远端存在而本地已删的文件会被删除。
 * - 需要 GitHub token（`repo` 权限），从环境变量 `GITHUB_TOKEN` 读；
 *   本机可这样取：`$cred = "protocol=https`nhost=github.com`n`n" | git credential fill`。
 *
 * 用法：
 *   $env:GITHUB_TOKEN = "…"
 *   node scripts/deploy-site-github.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, posix, resolve } from 'node:path';

const OWNER = 'wzy6789';
const REPO = 'VirtuGene-Mobile';
const ROOT = resolve(import.meta.dirname, '..');
const SITE_DIR = join(ROOT, 'website');
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error('缺少 GITHUB_TOKEN（GitHub 私人令牌，需要 repo 权限）');

const API = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'vg-site-deploy',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status} ${text.slice(0, 300)}`);
  return body;
}

/** git 的 blob 哈希：sha1("blob <字节数>\0" + 内容) */
function blobSha(buffer) {
  return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(posix.join('website', relative(base, full).split('\\').join('/')));
  }
  return out;
}

const repo = await gh(`/repos/${OWNER}/${REPO}`);
console.log(`仓库 ${repo.full_name}  默认分支=${repo.default_branch}  has_pages=${repo.has_pages}`);

try {
  await gh(`/repos/${OWNER}/${REPO}/contents/.github/workflows/deploy-pages.yml`);
  console.log('Pages workflow 存在，提交 website/** 会触发部署');
} catch {
  console.log('⚠️ GitHub 上没有 Pages workflow（.github/workflows/deploy-pages.yml），提交不会触发部署');
}

const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${repo.default_branch}`);
const headSha = ref.object.sha;
const headCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${headSha}`);
console.log(`远端 HEAD = ${headSha.slice(0, 8)}  ${(headCommit.message ?? '').split('\n')[0]}`);

const remoteTree = await gh(`/repos/${OWNER}/${REPO}/git/trees/${headCommit.tree.sha}?recursive=1`);
if (remoteTree.truncated) throw new Error('远端 tree 被截断，无法可靠比较；请改用 git push');
const remoteSite = new Map();
for (const item of remoteTree.tree) {
  if (item.type === 'blob' && item.path.startsWith('website/')) remoteSite.set(item.path, item.sha);
}

const localPaths = walk(SITE_DIR);
const changed = [];
const tree = [];
for (const path of localPaths) {
  const buffer = readFileSync(join(ROOT, path));
  if (remoteSite.get(path) === blobSha(buffer)) continue;
  const blob = await gh(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buffer.toString('base64'), encoding: 'base64' }),
  });
  tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  changed.push(`${path} (${buffer.length} B)`);
}
for (const path of remoteSite.keys()) {
  if (!localPaths.includes(path)) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
    changed.push(`${path} (删除)`);
  }
}

console.log(`需要更新 ${changed.length} 个文件：`);
for (const line of changed) console.log('  ' + line);
if (tree.length === 0) {
  console.log('远端 website/ 已与本地一致，无需提交。');
  process.exit(0);
}

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const newTree = await gh(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: headCommit.tree.sha, tree }),
});
const message = [
  `site: 官网内容同步（应用版本 ${version}）`,
  '',
  '官网内容与 VirtuGene-Mobile GitHub 仓库保持一致。',
  '此提交只更新 website/**。',
].join('\n');
const newCommit = await gh(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message, tree: newTree.sha, parents: [headSha] }),
});
await gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${repo.default_branch}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: newCommit.sha }),
});
console.log(`已提交：${newCommit.sha}`);
console.log(`站点：https://${OWNER.toLowerCase()}.github.io/${REPO}/`);
console.log('部署进度：https://github.com/' + OWNER + '/' + REPO + '/actions/workflows/deploy-pages.yml');
