/** 手机端自动更新：读取 Gitee Release，并交给系统下载器安装 APK。 */
import { APP_VERSION, GITEE_API } from './update-config';

export interface UpdateInfo {
  version: string;
  apkUrl: string;
  notes: string;
  hasUpdate: boolean;
}

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  browserDownloadUrl?: string;
}

interface GiteeRelease {
  id?: number;
  tag_name?: string;
  body?: string;
  assets?: ReleaseAsset[];
  attach_files?: ReleaseAsset[];
}

/** 版本号比较：'2.0.10' > '2.0.9'。 */
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

function pickApkUrl(assets: ReleaseAsset[] | undefined): string | null {
  const apk = assets?.find((asset) => asset.name?.toLowerCase().endsWith('.apk'));
  const url = apk?.browser_download_url ?? apk?.browserDownloadUrl;
  return url && /^https:\/\//i.test(url) ? url : null;
}

async function fetchReleaseAssets(release: GiteeRelease): Promise<string | null> {
  // Gitee 可能把附件放在 attach_files，也可能需要单独读取附件接口。
  const inline = pickApkUrl(release.attach_files) ?? pickApkUrl(release.assets);
  if (inline || !release.id) return inline;
  const res = await fetch(`${GITEE_API}/releases/${release.id}/attach_files`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return pickApkUrl(await res.json() as ReleaseAsset[]);
}

/** 没有可下载 APK 的 Release 不会被误报为可更新。 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(`${GITEE_API}/releases/latest`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const release = await res.json() as GiteeRelease;
    const version = release.tag_name?.replace(/^v/i, '');
    if (!version || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) return null;
    const apkUrl = await fetchReleaseAssets(release);
    if (!apkUrl) return null;
    return {
      version,
      apkUrl,
      notes: release.body ?? '',
      hasUpdate: compareVersions(version, APP_VERSION) > 0,
    };
  } catch {
    return null;
  }
}

/** Gitee 附件直接交给系统下载器；不再套用 GitHub 专用镜像。 */
export async function openApkDownload(apkUrl: string): Promise<string | null> {
  if (!/^https:\/\//i.test(apkUrl)) return null;
  window.open(apkUrl, '_system');
  return apkUrl;
}
