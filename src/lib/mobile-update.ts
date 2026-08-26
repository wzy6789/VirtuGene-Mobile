/**
 * 手机端自动更新（GitHub Releases + 国内镜像加速）。
 *
 * 流程：
 *   1. 启动时 check()：请求 GitHub API 拿最新 release 版本号 + APK 下载地址
 *   2. 有新版本（且比当前版本新）→ 返回更新信息，UI 提示用户
 *   3. 用户点「立即更新」→ openDownload()：用系统下载器打开镜像下载链接
 *      （WebView 打开下载链接 → Android 系统下载器接管 → 用户点通知栏安装）
 *
 * 优点：零原生插件依赖、无需额外权限、国内走镜像加速。
 * 缺点：下载走系统下载器，用户需点一下通知栏完成安装（个人使用完全可接受）。
 */
import { GITHUB_API, DOWNLOAD_MIRRORS, APP_VERSION } from './update-config';

export interface UpdateInfo {
  /** 最新版本号（如 2.0.3） */
  version: string;
  /** 官方 APK 下载地址 */
  apkUrl: string;
  /** release 备注 */
  notes: string;
  /** 是否有比当前更新的版本 */
  hasUpdate: boolean;
}

/** 版本号比较：'2.0.10' > '2.0.9' */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** 从 GitHub release 里挑 APK 下载链接（取 release 资产里的 .apk 文件，兜底 release body 里的直链） */
function pickApkUrl(release: {
  tag_name?: string;
  assets?: { name?: string; browser_download_url?: string }[];
  body?: string;
}): string | null {
  if (release.assets) {
    const apk = release.assets.find((a) => a.name?.toLowerCase().endsWith('.apk'));
    if (apk?.browser_download_url) return apk.browser_download_url;
  }
  const m = release.body?.match(/https:\/\/[^\s]+\.apk/i);
  return m ? m[0] : null;
}

/** 检查更新：请求 GitHub API（走代理时由外部配置决定；这里直接 fetch） */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(GITHUB_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const release = await res.json();
    const latest = (release.tag_name ?? '').replace(/^v/i, '');
    const apkUrl = pickApkUrl(release);
    if (!latest || !apkUrl) return null;
    return {
      version: latest,
      apkUrl,
      notes: release.body ?? '',
      hasUpdate: compareVersions(latest, APP_VERSION) > 0,
    };
  } catch {
    return null;
  }
}

/**
 * 用系统下载器打开 APK（镜像优先，失败自动换下一个）。
 * 返回实际采用的下载地址（便于提示用户）。
 */
export async function openApkDownload(apkUrl: string): Promise<string | null> {
  for (let i = 0; i < DOWNLOAD_MIRRORS.length; i++) {
    const url = DOWNLOAD_MIRRORS[i](apkUrl);
    try {
      // 镜像可用性探测：HEAD 请求，成功则用该地址
      const probe = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
      if (probe.ok || probe.status === 200) {
        // 交给系统下载器（WebView 打开会触发 Android 下载）
        window.open(url, '_system');
        return url;
      }
    } catch {
      /* 镜像不可用 → 试下一个 */
    }
  }
  // 全挂：直接打开官方地址（可能很慢，但至少试了）
  window.open(apkUrl, '_system');
  return apkUrl;
}
