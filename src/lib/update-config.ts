/**
 * 手机端自动更新配置（GitHub Releases + 国内镜像加速）。
 *
 * ⚠️ 使用前先做两件事：
 * 1. 在 GitHub 创建一个仓库（如 VirtuGene-Mobile），把仓库 owner/name 填到下面 GITHUB_REPO
 * 2. 以后每次发版：构建 APK → 在 GitHub Releases 页面传 APK + 填版本号（如 v2.0.3）
 *
 * 更新流程（手机端启动时自动检查）：
 *   - 请求 GitHub API 获取最新 release 的版本号和 APK 下载地址
 *   - 有新版 → 提示下载 → 走「镜像优先、官方兜底」下载 APK → 调系统安装器
 *   - 国内用户直连 GitHub 慢，所以下载地址会优先拼国内镜像（ghproxy 等），失败自动换下一个
 */

/** GitHub 仓库（owner/repo） */
export const GITHUB_REPO = 'wzy6789/VirtuGene-Mobile';

/** GitHub Release API（用于获取最新版本信息；可换 ghproxy 镜像加速 API） */
export const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/**
 * APK 下载镜像列表（按顺序尝试）：
 *  - 每个模板里的 {url} 会被替换成官方下载地址
 *  - 先试国内镜像（快），再试官方（兜底）
 */
export const DOWNLOAD_MIRRORS: ((officialUrl: string) => string)[] = [
  // ghproxy 系镜像（国内常用加速）
  (url) => `https://gh-proxy.com/${url}`,
  (url) => `https://ghfast.top/${url}`,
  // 官方直连兜底
  (url) => url,
];

/** 版本号：从 Android build.gradle 的 versionName 读取（脚本自动替换） */
export const APP_VERSION = '__APP_VERSION__';
