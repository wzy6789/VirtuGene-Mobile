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
 *  - 每个模板把官方下载地址拼到镜像前缀后
 *  - 先测每个镜像连通性+耗时，选最快可用的打开；全部失败才用官方
 *  - 镜像按实测速度排序（2026-08 实测：gh.ddlc.top 最快，gh-proxy.com 次之）
 */
export const DOWNLOAD_MIRRORS: ((officialUrl: string) => string)[] = [
  (url) => `https://gh.ddlc.top/${url}`,
  (url) => `https://gh-proxy.com/${url}`,
  (url) => `https://ghps.cc/${url}`,
  (url) => `https://ghproxy.net/${url}`,
  (url) => `https://ghfast.top/${url}`,
  // 官方直连兜底
  (url) => url,
];

/**
 * 版本号：Vite define 注入的裸标识符（无引号才能被替换成 package.json version）
 * 注意：不能写成字符串 '__APP_VERSION__'，否则不会替换
 */
export const APP_VERSION: string = __APP_VERSION__;
